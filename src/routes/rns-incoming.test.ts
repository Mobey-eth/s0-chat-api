import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import {registerRnsIncomingRoutes} from "./rns-incoming.js";
const address="0x1111111111111111111111111111111111111111";
test("incoming names are a GET-only mainnet read with a stable address-scoped envelope",async()=>{
 const app=Fastify();let lookups=0;
 await registerRnsIncomingRoutes(app,async(wallet)=>{assert.equal(wallet,address);lookups++;return [];});
 const result=await app.inject(`/api/public/rns/incoming/${address}?chainId=4153`);
 assert.equal(result.statusCode,200);assert.deepEqual(result.json(),{chainId:4153,address,items:[]});assert.equal(result.headers["cache-control"],"no-store");
 assert.equal((await app.inject(`/api/public/rns/incoming/bad`)).statusCode,400);
 assert.equal((await app.inject(`/api/public/rns/incoming/${address}?chainId=11155931`)).statusCode,400);
 assert.equal((await app.inject({method:"POST",url:`/api/public/rns/incoming/${address}`})).statusCode,404);
 assert.equal(lookups,1);await app.close();
});
