import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildOrderAccessPlan } from '../scripts/lib/order-access-plan.mjs';
import { patchBuyCourse } from '../scripts/lib/buy-course-workflow-patch.mjs';

const baseline = JSON.parse(fs.readFileSync(new URL('../reviews/2026-11-07-multicourse-access/BuyCourse.baseline.redacted.json', import.meta.url)));
const order = { id: 'synthetic-order', owner: 'synthetic-buyer', course_positions: ['p1', 'p2', 'p3', 'p4'] };
const positions = order.course_positions.map((id, i) => ({ id, owner: order.owner, course_id: 'c' + i, price: 100 + i }));
const courses = positions.map((p, i) => ({ id: p.course_id, owner: 'author', DurationLong: i === 0 ? 6 : 0, Title: 'Synthetic' }));
const authors = [{ id: 'author', authorCommission: 70 }];

test('reproduces production PickBuyerRow collapsing four items to one', () => {
    const n = baseline.nodes.find(n => n.name === 'PickBuyerRow');
    const $ = name => ({ item: { json: name === 'UsersBuyer' ? { id: order.owner } : { id: courses[0].id } } });
    const $input = { all: () => courses.map((c, i) => ({ json: { id: 'access' + i, user: order.owner, course: c.id } })) };
    const result = new Function('$', '$input', n.parameters.jsCode)($, $input);
    assert.equal(result.length, 1);
    assert.equal(result[0].json.course, courses[0].id);
    assert.deepEqual(result[0].pairedItem, { item: 0 });
});
test('single and four-course plans include every paid position and the actual buyer', () => {
    assert.equal(buildOrderAccessPlan({ ...order, course_positions: ['p1'] }, positions, courses, authors).length, 1);
    const plan = buildOrderAccessPlan(order, positions, courses, authors);
    assert.deepEqual(plan.map(p => p.shop_id), order.course_positions);
    assert.deepEqual(plan.map(p => p.course_id), courses.map(c => c.id));
    assert.equal(plan[0].author_amount, (positions[0].price * 70 / 100).toFixed(2));
});
test('commission retains exact old JS floating point/toFixed rounding, including half-cent and null', () => {
    for (const [price, rate] of [[1.005, 100], [2.675, 100], [2450, 70], [null, 70], [100, null]]) {
        const plan = buildOrderAccessPlan({ ...order, course_positions: ['p1'] }, [{ ...positions[0], price }], courses, [{ id: 'author', authorCommission: rate }]);
        assert.equal(plan[0].author_amount, (price * rate / 100).toFixed(2));
        assert(!('end_period' in plan[0]), 'unlocked client snapshot must not calculate renewal expiry');
    }
});
test('missing courses, positions or buyer mismatches fail before any write', () => {
    assert.throws(() => buildOrderAccessPlan(order, positions.slice(1), courses, authors));
    assert.throws(() => buildOrderAccessPlan(order, positions, courses.slice(1), authors));
    assert.throws(() => buildOrderAccessPlan(order, positions.map(p => ({ ...p, owner: 'wrong' })), courses, authors));
});
test('workflow reads order early; one atomic RPC replaces every access/sales/balance write', () => {
    const w = patchBuyCourse(baseline);
    assert.equal(w.nodes.find(n => n.name === 'Supabase').parameters.operation, 'get');
    assert.equal(w.connections.UsersBuyer.main[0][0].node, 'BuildAllAccesses');
    assert.equal(w.connections.BuildAllAccesses.main[0][0].node, 'FulfillAllAccesses');
    assert.equal(w.nodes.find(n => n.name === 'FulfillAllAccesses').onError, 'stopWorkflow');
    assert.deepEqual(w.connections.FulfillAllAccesses, { main: [[]] });
    assert(!w.nodes.some(n => ['PickBuyerRow', 'Supabase5', 'UpdateUserCourse', 'Create_Sales', 'Code1', 'Supabase1', 'Supabase2'].includes(n.name)));
    for (const group of Object.values(w.connections)) for (const branch of group.main || []) {
        for (const target of branch) assert(w.nodes.some(n => n.name === target.node), target.node);
    }
});
test('signature/amount checks, other webhook branches and paid-history skip stay unchanged', () => {
    const w = patchBuyCourse(baseline);
    for (const name of ['VerifySign','VerifySignRPC','VerifyAmount','AuditWarn','CheckPaid','IF_AlreadyPaid','Webhook','TG_Bot','SendEmail','HTTP Request']) {
        assert.deepEqual(w.nodes.find(n => n.name === name), baseline.nodes.find(n => n.name === name), name);
    }
    assert.deepEqual(w.connections.IF_AlreadyPaid, baseline.connections.IF_AlreadyPaid);
});
test('new all-items Code routes each product to its own author without balance snapshots', () => {
    const w = patchBuyCourse(baseline);
    const data = { CheckPaid: [order], GetPositions: positions, GetCourse: courses, UsersCreater: [{ id: 'author', authorCommission: 70 }] };
    const $ = name => ({ first: () => ({ json: data[name][0] }), all: () => data[name].map(json => ({ json })) });
    const plan = new Function('$', w.nodes.find(n => n.name === 'BuildAllAccesses').parameters.jsCode)($);
    assert.equal(plan[0].json.plan.length, 4);
    assert(plan[0].json.plan.every(p => p.author_id === 'author' && !('Ammount' in p)));
    const twoAuthors = [{ id: 'author', authorCommission: 70 }, { id: 'other', authorCommission: 50 }];
    const mixedCourses = courses.map((c, i) => ({ ...c, owner: i % 2 ? 'other' : 'author' }));
    assert.deepEqual(buildOrderAccessPlan(order, positions, mixedCourses, twoAuthors).map(p => p.author_id), ['author','other','author','other']);
});
test('configuration drift stops local patch generation', () => {
    assert.throws(() => patchBuyCourse({ ...baseline, updatedAt: 'changed' }));
});
