import { isDeepStrictEqual } from 'node:util';
import { buildAuthorSharePlan } from './author-share-plan.mjs';
const node=(w,name)=>{const n=w.nodes.find(n=>n.name===name);if(!n)throw Error('Missing node: '+name);return n;};
export function patchAuthorShareWorkflows(buyInput,clubInput,baseline) {
    const buy=structuredClone(buyInput),club=structuredClone(clubInput);
    for(const [w,key] of [[buy,'BuyCourse'],[club,'subscription']]) {
        const base=baseline.workflows[key];if(w.id!==base.id||w.name!==key)throw Error('Workflow identity changed');
        for(const n of base.nodes){const actual=node(w,n.name);if(actual.disabled||actual.continueOnFail||(actual.onError&&actual.onError!=='stopWorkflow'))throw Error('Unsafe financial node execution flags: '+n.name);if(actual.type!==n.type||actual.typeVersion!==n.typeVersion||!isDeepStrictEqual(actual.parameters,n.parameters))throw Error('Financial node baseline changed: '+n.name);}
        for(const [name,edges] of Object.entries(base.edges))if(!isDeepStrictEqual(w.connections[name],edges))throw Error('Connection baseline changed: '+name);
    }
    if(buy.nodes.some(n=>n.name==='GetAuthorShares'))throw Error('Share patch already present');
    const template=node(buy,'FulfillAllAccesses');
    if(!template.credentials?.supabaseApi)throw Error('Existing protected server credential required');
    const rpcUrl=name=>{const u=new URL(template.parameters.url);u.pathname='/rest/v1/rpc/'+name;u.search='';return u.href;};
    buy.nodes.push({id:'abafdc4b-05ef-43d5-b32b-d008228f1d36',name:'GetAuthorShares',type:template.type,typeVersion:template.typeVersion,position:[(template.position?.[0]||0)-200,template.position?.[1]||0],executeOnce:true,credentials:structuredClone(template.credentials),parameters:{method:'POST',url:rpcUrl('get_order_author_shares'),authentication:'predefinedCredentialType',nodeCredentialType:'supabaseApi',sendBody:true,specifyBody:'json',jsonBody:"={{ {p_order_id: $('CheckPaid').first().json.id} }}",options:{}}});
    buy.connections.UsersBuyer={main:[[{node:'GetAuthorShares',type:'main',index:0}]]};
    buy.connections.GetAuthorShares={main:[[{node:'BuildAllAccesses',type:'main',index:0}]]};
    node(buy,'BuildAllAccesses').parameters.jsCode=buildAuthorSharePlan.toString()+`\nconst order=$('CheckPaid').first().json;\nconst plan=buildAuthorSharePlan(order,$('GetPositions').all().map(i=>i.json),$('GetCourse').all().map(i=>i.json),$('UsersCreater').all().map(i=>i.json),$('GetAuthorShares').first().json.rates);\nreturn [{json:{plan},pairedItem:{item:0}}];`;
    const branches=[
        ['Code8','Supabase9','Supabase5','GET_SUBS','GET_CLUB',"$('Code18').first().json.Prolong",['Supabase10','Code15','Supabase3']],
        ['Code9','Supabase11','UPD_ORDER','Supabase','Supabase',"$('Webhook').first().json.body['products[0][name]']",['Supabase12','Code17','Supabase17']],
        ['Code10','Supabase13','UPD_ORDER2','Supabase8','Supabase8',"$('Webhook').first().json.body['products[0][name]']",['Supabase14','Code16','Supabase7']],
    ];
    for(const [name,credentialNode,order,sub,position,title,disabled] of branches){
        const n=node(club,name),cred=node(club,credentialNode).credentials;
        if(!cred?.supabaseApi||cred.supabaseApi.id!==template.credentials.supabaseApi.id)throw Error('Server credential differs; manual review required');
        n.type=template.type;n.typeVersion=template.typeVersion;n.credentials=structuredClone(cred);
        n.parameters={method:'POST',url:rpcUrl('settle_club_author_share'),authentication:'predefinedCredentialType',nodeCredentialType:'supabaseApi',sendBody:true,specifyBody:'json',jsonBody:`={{ {p_order_id: $('${order}').first().json.id,p_payment_id: String($('Webhook').first().json.body.order_id || ''),p_club_id: $('GET_CLUB').first().json.id,p_subscription_id: $('${sub}').first().json.id,p_amount: $('Webhook').first().json.body.sum,p_position_id: $('${position}').first().json.id,p_position_name: ${title}} }}`,options:{}};
        club.connections[name]={main:[[]]};for(const old of disabled)node(club,old).disabled=true;
    }
    return {BuyCourse:buy,subscription:club};
}
