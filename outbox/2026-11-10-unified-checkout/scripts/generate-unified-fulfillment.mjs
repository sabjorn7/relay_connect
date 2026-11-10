// Local source generator, no env/network. Preserve the deployed financial/access algorithm verbatim.
import fs from 'node:fs';
const root=new URL('../',import.meta.url);
const baseline=fs.readFileSync(new URL('tests/fixtures/checkout-legacy-fulfillment.sql',root),'utf8');
let code=baseline.slice(baseline.indexOf('CREATE OR REPLACE FUNCTION'));
code=code.replace('    v_credits jsonb', '    v_zero boolean := false;\n    v_credits jsonb');
const lock='    select * into v_order from public."order" where id=p_order_id for update;';
if(!code.includes(lock))throw Error('baseline changed');
code=code.replace(lock,'    perform checkout_private.lock_all();\n'+lock);
const receipt='    select * into v_receipt from public.order_access_fulfillments where order_id=p_order_id;';
code=code.replace(receipt,`    v_zero := p_proof_id is null and p_payment_id='zero:'||p_order_id::text and exists(
      select 1 from checkout_private.orders where order_id=p_order_id and total=0);
    if v_order.checkout_version=1 and not v_zero then
      perform 1 from public.payment_audit a where a.id=p_proof_id and a.order_id=p_order_id and a.event='ok'
       and a.detail->>'sig_valid'='true' and a.detail->>'payment_status'='success' and a.detail->'verify'->>'ok'='true' for share;
      if not found then raise exception 'verified_success_required' using errcode='42501';end if;
    end if;
`+receipt);
const proof=/    perform 1 from public\.payment_audit a\n[\s\S]*?    if not found then raise exception 'verified_success_required' using errcode='42501'; end if;/;
if(!proof.test(code))throw Error('proof baseline changed');
code=code.replace(proof,m=>'    if not v_zero then\n'+m+'\n    end if;');
const authors='    -- Lock all credited authors in a stable order.';
code=code.replace(authors,`    perform checkout_private.validate_snapshot(p_order_id,p_access_plan);
`+authors);
const paid='    update public."order" set paid=true,payment_id=p_payment_id where id=p_order_id;';
code=code.replace(paid,'    perform checkout_private.finish_products(p_order_id);\n'+paid);
const ret="    return jsonb_build_object('status','fulfilled'";
code=code.replace(ret,`    update public.order_access_fulfillments set result=result||jsonb_build_object('checkout_kind',case when v_zero then 'zero' else 'paid' end) where order_id=p_order_id;
`+ret);
// Assert EXACT legacy loop, date math and commission credit algorithm. No new rounding formula.
const financial=s=>s.slice(s.indexOf('    -- Lock all credited authors'),s.indexOf(paid)).replace('    perform checkout_private.finish_products(p_order_id);\n','');
if(financial(code)!==financial(baseline))throw Error('financial algorithm changed');
const target=new URL('supabase/migrations/pending_unified_checkout.sql',root);
const marker='-- GENERATED FULFILLMENT: scripts/generate-unified-fulfillment.mjs';
const sql=fs.readFileSync(target,'utf8');
if(sql.includes(marker))throw Error('already generated; edit the reviewed migration explicitly');
fs.appendFileSync(target,'\n'+marker+'\n'+code+'\n');
console.log('Generated compatible fulfillment; financial section byte-identical to production baseline');
