'use strict';
const {validate}=require('../endstep-reader/studio-schema');
const modelError=(code,message)=>Object.assign(Error(message),{code});
const httpReasons={
  400:'接口拒绝了请求。请核对模型 ID 及模型是否支持 Chat Completions。',
  401:'API 密钥无效或已过期。',
  403:'密钥没有此模型或接口的访问权限。',
  404:'未找到 API 路径或模型 ID。请核对服务商给出的基址和模型。',
  413:'服务商拒绝了过大的局面输入。',
  422:'服务商无法处理请求格式。请核对接口和模型。',
  429:'请求频率或额度超限。请稍后重试，或检查服务商的余额与配额。'
};

function compatibleModel({baseUrl,model,key}={}){
  let url;
  try{url=new URL(String(baseUrl||'').trim());}catch{throw Error('请输入完整的 API 地址。');}
  const loopback=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if(url.username||url.password||url.search||url.hash||!(url.protocol==='https:'||loopback&&url.protocol==='http:'))throw Error('API 地址须使用 HTTPS，本机接口可以使用 HTTP。');
  url.pathname=url.pathname.replace(/\/+$/,'');
  if(!url.pathname.endsWith('/chat/completions'))url.pathname+='/chat/completions';
  if(typeof model!=='string'||!model.trim()||model.length>200)throw Error('请输入服务商提供的模型 ID。');
  if(typeof key!=='string'||key.length>4096||/[\r\n]/.test(key))throw Error('API 密钥格式不正确。');
  if(!key.trim()&&!loopback)throw Error('请输入 API 密钥。');
  return {model:model.trim(),endpoint:url.href,async generate({instructions,prompt,schema,signal}){
    const messages=[{role:'system',content:instructions+'\n仅返回符合以下 JSON Schema 的 JSON 对象。\n'+JSON.stringify(schema)},{role:'user',content:prompt}];
    const headers={'Content-Type':'application/json',...(key.trim()?{Authorization:'Bearer '+key.trim()}:{})};
    const formats=[{type:'json_schema',json_schema:{name:'endstep_result',strict:true,schema}},{type:'json_object'},undefined];
    for(const response_format of formats){
      let response;
      try{response=await fetch(url,{method:'POST',headers,body:JSON.stringify({model:model.trim(),messages,response_format}),signal:AbortSignal.any([signal,AbortSignal.timeout(180000)]),redirect:'error'});}
      catch(error){
        if(signal.aborted&&signal.reason?.name!=='TimeoutError')signal.throwIfAborted();
        throw error.name==='TimeoutError'?modelError('model_timeout','模型 API 请求超时。'):modelError('model_connection','无法连接到模型 API。请核对地址、网络和 HTTPS 证书。');
      }
      if(!response.ok){
        const diagnostic=await response.text();
        if(response_format&&[400,422].includes(response.status)&&/response.?format|json.schema|json.object|structured output/i.test(diagnostic))continue;
        throw modelError('model_http','模型 API 返回 HTTP '+response.status+'。'+(httpReasons[response.status]||(response.status>=500?'服务商端出错，请稍后重试。':'请查看服务商的接口文档。')));
      }
      const data=await response.json().catch(()=>null),choice=data?.choices?.[0];
      if(choice?.message?.refusal||choice?.finish_reason==='content_filter')throw modelError('model_refusal','模型拒绝处理这条请求。');
      if(choice?.finish_reason==='length')throw modelError('model_truncated','模型输出达到长度上限，动作数据被截断。');
      if(typeof choice?.message?.content!=='string')throw modelError('model_protocol','接口响应缺少 Chat Completions 的文字内容。');
      let result;
      try{
        result=JSON.parse(choice.message.content.trim().replace(/^```(?:json)?\s*|\s*```$/gi,''));
      }catch{throw modelError('model_json','模型返回的内容不是有效 JSON。请重试或选择支持结构化输出的模型。');}
      try{validate(result,schema);}
      catch(error){throw modelError('model_schema','模型输出字段校验失败。'+error.message);}
      return result;
    }
    throw modelError('model_protocol','该模型 API 无法完成 JSON 请求。');
  }};
}
module.exports={compatibleModel};
