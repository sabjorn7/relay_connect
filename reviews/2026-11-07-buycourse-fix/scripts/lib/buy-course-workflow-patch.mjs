import { buildOrderAccessPlan } from './order-access-plan.mjs';

// Pure local transformation. Does not contact n8n or write a workflow.
export function patchBuyCourse(workflow) {
    if (workflow.id !== '6rEQ42XwaLMFcvbB' || workflow.updatedAt !== '2026-10-29T14:14:01.485Z') {
        throw new Error('Production workflow changed; review the new graph before patching');
    }
    const w = structuredClone(workflow);
    const node = name => {
        const matches = w.nodes.filter(n => n.name === name);
        if (matches.length !== 1) throw new Error('Missing/ambiguous node: ' + name);
        return matches[0];
    };
    if (node('PickBuyerRow').parameters.mode !== 'runOnceForAllItems'
        || !node('PickBuyerRow').parameters.jsCode.includes('pairedItem: { item: 0 }')
        || node('Supabase').parameters.operation !== 'update'
        || node('Supabase').parameters.tableId !== 'order') throw new Error('Access baseline changed');
    const verify = node('VerifyAmount');
    if (verify.parameters.authentication !== 'predefinedCredentialType'
        || verify.parameters.nodeCredentialType !== 'supabaseApi'
        || !verify.credentials?.supabaseApi) throw new Error('Existing server credential required');
    const next = target => ({ main: [[{ node: target, type: 'main', index: 0 }]] });

    // Keep the node name/ID for existing expressions, but make early order loading READ ONLY.
    const readOrder = node('Supabase');
    readOrder.parameters.operation = 'get';
    delete readOrder.parameters.fieldsUi;

    const build = {
        id: 'payment-build-all-accesses', name: 'BuildAllAccesses',
        type: 'n8n-nodes-base.code', typeVersion: 2, position: [1200, 600],
        parameters: { mode: 'runOnceForAllItems', jsCode:
            buildOrderAccessPlan.toString() + '\n' +
            `const order = $('CheckPaid').first().json;
const plan = buildOrderAccessPlan(order, $('GetPositions').all().map(i => i.json), $('GetCourse').all().map(i => i.json), $('UsersCreater').all().map(i => i.json));
return [{json:{plan},pairedItem:{item:0}}];` },
    };
    const fulfill = structuredClone(verify);
    fulfill.id = 'payment-fulfill-access-transaction';
    fulfill.name = 'FulfillAllAccesses';
    fulfill.position = [1420, 600];
    if (!/\/verify_order_payment$/.test(fulfill.parameters.url)) throw new Error('Unexpected VerifyAmount URL');
    fulfill.parameters.url = fulfill.parameters.url.replace(/\/verify_order_payment$/, '/fulfill_paid_course_order');
    fulfill.parameters.jsonBody = `={{ {
  p_order_id: $('CheckPaid').first().json.id,
  p_payment_id: String($('Shop').first().json.body.order_id || ''),
  p_proof_id: $('AuditWarn').first().json.id,
  p_access_plan: $json.plan
} }}`;
    fulfill.executeOnce = true;
    fulfill.onError = 'stopWorkflow';
    fulfill.continueOnFail = false;
    fulfill.retryOnFail = false;

    const retired = ['GetUserCourse', 'PickBuyerRow', 'IF_Exists', 'UpdateUserCourse', 'Supabase5',
        'Create_Sales', 'Code1', 'Supabase1', 'Supabase2'];
    for (const name of retired) node(name);
    // These writes now belong to the same PostgreSQL transaction, never to a post-RPC branch.
    w.nodes = w.nodes.filter(n => !retired.includes(n.name));
    for (const name of retired) delete w.connections[name];
    w.nodes.push(build, fulfill);
    w.connections.UsersBuyer = next(build.name);
    w.connections[build.name] = next(fulfill.name);
    w.connections[fulfill.name] = { main: [[]] };
    // Existing paid=true branch remains a legacy/duplicate no-op, not a replay.
    if (w.connections.IF_AlreadyPaid.main[0][0].node !== 'AuditDuplicate') throw new Error('Paid branch changed');
    return w;
}
