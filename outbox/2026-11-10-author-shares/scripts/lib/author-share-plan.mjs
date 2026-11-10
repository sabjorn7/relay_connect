// Financial operation order intentionally matches the active BuyCourse Code node.
export function buildAuthorSharePlan(order, positions, courses, authors, rates) {
    if (!order?.id || !order.owner || !Array.isArray(order.course_positions) || !order.course_positions.length) throw new Error('Invalid course order');
    if (new Set(order.course_positions).size !== order.course_positions.length) throw new Error('Duplicate shop position');
    if (!Array.isArray(rates)) throw new Error('Missing server shares');
    return order.course_positions.map(id => {
        const matches = positions.filter(p => p.id === id);
        if (matches.length !== 1) throw new Error('Missing or ambiguous shop position');
        const position = matches[0];
        if (position.owner !== order.owner) throw new Error('Buyer mismatch');
        const course = courses.find(c => c.id === position.course_id);
        const author = course && authors.find(a => a.id === course.owner);
        const found = rates.filter(r => r.course_id === course?.id);
        if (!course || !author || found.length !== 1 || found[0].author_id !== author.id) throw new Error('Missing or ambiguous author share');
        const share = found[0];
        if (!['courses','streams','events'].includes(share.category) || !Number.isFinite(share.percent) || share.percent < 0 || share.percent > 100 || (position.price !== null && !Number.isFinite(position.price))) throw new Error('Invalid financial snapshot');
        const authorAmount = (position.price * share.percent / 100).toFixed(2);
        if (!/^-?\d+\.\d{2}$/.test(authorAmount)) throw new Error('Invalid author amount');
        return { shop_id:id, course_id:course.id, author_id:author.id, price:position.price, author_commission:share.percent, author_amount:authorAmount };
    });
}
