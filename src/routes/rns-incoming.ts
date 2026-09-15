import type {FastifyInstance} from "fastify";
import {getAddress,isAddress} from "viem";
import {z} from "zod";
import {config} from "../config.js";
import {listIncomingRnsTransfers} from "../rns/incoming-transfers.js";

// Called inside the existing public-RNS rate-limited group on Senna only.
export async function registerRnsIncomingRoutes(app:FastifyInstance,lookup=listIncomingRnsTransfers) {
  app.get("/api/public/rns/incoming/:address",async(request,reply)=>{
    const params=z.object({address:z.string().refine(value=>isAddress(value,{strict:true}))}).safeParse(request.params);
    const query=z.object({chainId:z.coerce.number().int().refine(value=>value===config.riseChainId).optional()}).safeParse(request.query);
    if(!params.success)return reply.code(400).send({error:"invalid_address"});
    if(!query.success)return reply.code(400).send({error:"unsupported_chain"});
    const address=getAddress(params.data.address).toLowerCase();
    reply.header("cache-control","no-store");
    return reply.send({chainId:config.riseChainId,address,items:await lookup(address)});
  });
}
