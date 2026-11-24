"""Generate a review-only diff from pinned SDK sources. Never writes into the SDK."""
import difflib
import hashlib
import json
import sys
from pathlib import Path

source = Path(sys.argv[1])
output = Path(sys.argv[2])
original = source.read_text()
assert hashlib.sha256(original.encode()).hexdigest() == '98ef20fe0d3dae873d1039a10c084bdfcd9203ea7dfe42c7316cf12ddb9807d0', 'sdk_sha_mismatch'
text = original

def replace_once(old, new):
    global text
    assert text.count(old) == 1, 'source_shape_mismatch'
    text = text.replace(old, new, 1)

replace_once(
    "import { LockAcquireTimeoutError, navigatorLock } from './lib/locks'",
    "import { LockAcquireTimeoutError, navigatorLock, processLock } from './lib/locks'",
)

# An expected token is attached to terminal cleanup, not a persistent storage flag.
replace_once(
    """          } else {
            await this._removeSession()
          }
        }

        // Cache the failure""",
    """          } else {
            // Only this rejected refresh may authorize conditional removal.
            // Keep the original server error even if local coordination fails.
            try {
              await this._removeSession(refreshToken)
            } catch {
              this._debug(debugName, 'conditional session cleanup not completed')
            }
          }
        }

        // Cache the failure""",
)

# A refresh commit and a logout must participate in the same storage transaction.
start = text.index('      // Second leg of the commit guard:')
end = text.index("      await this._notifyAllSubscribers('TOKEN_REFRESHED', data.session)", start)
text = text[:start] + """      const saved = await this._saveSession(
        data.session,
        storedAtStart?.refresh_token ?? null
      )
      if (!saved) {
        const discarded: CallRefreshTokenResult = {
          data: null,
          error: new AuthRefreshDiscardedError(),
        }
        this.refreshingDeferred.resolve(discarded)
        return discarded
      }

""" + text[end:]

# Legacy hydration is another writer of the same session slot.
replace_once(
    """            await removeItemAsync(this.storage, this.storageKey + '-user')
            await setItemAsync(this.storage, this.storageKey, currentSession)""",
    """            await this._withSessionWriteLock(async () => {
              const latest = (await getItemAsync(this.storage, this.storageKey)) as Session | null
              if (latest?.refresh_token !== currentSession.refresh_token) return
              await removeItemAsync(this.storage, this.storageKey + '-user')
              await setItemAsync(this.storage, this.storageKey, currentSession)
            })""",
)
replace_once(
    """          await setItemAsync(this.userStorage, this.storageKey + '-user', maybeUser)""",
    """          await this._withSessionWriteLock(async () => {
            const latest = (await getItemAsync(this.storage, this.storageKey)) as Session | null
            if (latest?.refresh_token !== currentSession.refresh_token) return
            await setItemAsync(this.userStorage!, this.storageKey + '-user', maybeUser)
          })""",
)

replace_once(
    '  private async _saveSession(session: Session) {',
    """  // Separate from the legacy auth-operation lock. No HTTP or awaited
  // subscribers are allowed inside this short storage-only critical section.
  private async _withSessionWriteLock<R>(fn: () => Promise<R>): Promise<R> {
    const name = `lock:session-write:${this.storageKey}`
    if (isBrowser()) {
      // No silent process-local fallback for shared browser storage.
      if (!globalThis.navigator?.locks?.request) {
        throw new Error('Session write coordination unavailable')
      }
      // Do not use navigatorLock here: its timeout recovery can steal a live
      // lock. A storage transaction must never overlap the previous holder.
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 5000)
      try {
        return await globalThis.navigator.locks.request(
          name,
          { mode: 'exclusive', signal: controller.signal },
          async (lock) => {
            clearTimeout(timer)
            if (!lock) throw new Error('Session write lock unavailable')
            return await fn()
          }
        )
      } finally {
        clearTimeout(timer)
      }
    }
    // Only same-process storage is covered by this fallback; not distributed SSR.
    return await processLock(name, 5000, fn)
  }

  private async _saveSession(
    session: Session,
    expectedRefreshToken?: string | null
  ): Promise<boolean> {
    return await this._withSessionWriteLock(async () => {
      if (expectedRefreshToken !== undefined) {
        const current = (await getItemAsync(this.storage, this.storageKey)) as Session | null
        if ((current?.refresh_token ?? null) !== expectedRefreshToken) return false
      }
      await this._saveSessionUnderWriteLock(session)
      return true
    })
  }

  private async _saveSessionUnderWriteLock(session: Session) {""",
)

start = text.index('  private async _removeSession() {')
end = text.index('\n  /**', start)
text = text[:start] + """  private async _removeSession(expectedRefreshToken?: string): Promise<boolean> {
    let notification: Promise<void> | undefined
    const removed = await this._withSessionWriteLock(async () => {
      if (expectedRefreshToken !== undefined) {
        const current = (await getItemAsync(this.storage, this.storageKey)) as Session | null
        if (!current || current.refresh_token !== expectedRefreshToken) return false
        if (current.expires_at && current.expires_at * 1000 > Date.now()) return false
      }

      this._sessionRemovalEpoch += 1
      this.lastRefreshFailure = null
      this.suppressGetSessionWarning = false
      await removeItemAsync(this.storage, this.storageKey)
      // A failed refresh of A must not cancel an in-progress OAuth login B.
      // Explicit logout retains its existing PKCE cleanup.
      if (expectedRefreshToken === undefined) {
        await removeAllPKCEVerifiers(this.storage, this.storageKey)
      }
      await removeItemAsync(this.storage, this.storageKey + '-user')
      if (this.userStorage) {
        await removeItemAsync(this.userStorage, this.storageKey + '-user')
      }

      // Dispatch starts while writers are serialized, but NEVER await a
      // subscriber here: a subscriber is allowed to perform another login.
      notification = this._notifyAllSubscribers('SIGNED_OUT', null)
      notification.catch(() => {})
      return true
    })
    await notification
    return removed
  }
""" + text[end:]

# Initialization queues notifications; don't replay an old SIGNED_OUT over B.
replace_once(
    """    for (const n of queue) {
      await this._notifyAllSubscribers(n.event, n.session, n.broadcast)
    }""",
    """    for (const n of queue) {
      if (n.event !== 'SIGNED_OUT') {
        await this._notifyAllSubscribers(n.event, n.session, n.broadcast)
        continue
      }
      let notification: Promise<void> | undefined
      await this._withSessionWriteLock(async () => {
        if ((await getItemAsync(this.storage, this.storageKey)) !== null) return
        notification = this._notifyAllSubscribers(n.event, n.session, n.broadcast)
        notification.catch(() => {})
      })
      await notification
    }""",
)

patch = ''.join(difflib.unified_diff(
    original.splitlines(True), text.splitlines(True),
    fromfile='a/src/GoTrueClient.ts', tofile='b/src/GoTrueClient.ts',
))
assert not output.exists(), 'refuse_overwrite'
output.write_text(patch)
manifest = {
    'sdk': '@supabase/auth-js', 'version': '2.119.2',
    'base_sha256': hashlib.sha256(original.encode()).hexdigest(),
    'proposed_sha256': hashlib.sha256(text.encode()).hexdigest(),
    'patch_sha256': hashlib.sha256(patch.encode()).hexdigest(),
    'status': 'PROPOSAL_ONLY_NOT_APPLIED_NOT_RUNTIME_TESTED',
}
manifest_path = output.with_suffix('.json')
assert not manifest_path.exists()
manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps(manifest))
