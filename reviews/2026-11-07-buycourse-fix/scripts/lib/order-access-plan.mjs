// Embedded unchanged in n8n. Pure calculation; no credentials, network or writes.
export function buildOrderAccessPlan(order, positions, courses, authors) {
    if (!order?.id || !order.owner || !Array.isArray(order.course_positions) || !order.course_positions.length) {
        throw new Error('Invalid course order');
    }
    if (new Set(order.course_positions).size !== order.course_positions.length) throw new Error('Duplicate shop position');
    return order.course_positions.map(id => {
        const matches = positions.filter(p => p.id === id);
        if (matches.length !== 1) throw new Error('Missing or ambiguous shop position');
        const position = matches[0];
        if (position.owner !== order.owner) throw new Error('Buyer mismatch');
        const course = courses.find(c => c.id === position.course_id);
        const author = course && authors.find(a => a.id === course.owner);
        if (!course || !author) throw new Error('Missing course or author');
        if ((position.price !== null && !Number.isFinite(position.price))
            || (author.authorCommission !== null && !Number.isFinite(author.authorCommission))) {
            throw new Error('Invalid financial snapshot');
        }
        // EXACT production Create_Sales formula, including JS floating-point/toFixed
        // rounding and null -> zero. Never replace it silently with SQL round(numeric).
        const authorAmount = (position.price * author.authorCommission / 100).toFixed(2);
        if (!/^-?\d+\.\d{2}$/.test(authorAmount)) throw new Error('Invalid author amount');
        return {
            shop_id: id, course_id: course.id, author_id: author.id,
            price: position.price, author_commission: author.authorCommission,
            author_amount: authorAmount,
        };
    });
}
