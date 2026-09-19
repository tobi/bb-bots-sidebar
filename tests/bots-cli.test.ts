import { frameBotMessage } from "../lib/bots-cli";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makePluginAgentConfigurationContext, makeQueueEntry, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { backend, project } from "./backend-fixture";
import { botProjectContext } from "../lib/project-context";
import { botInstructions, BOT_GUIDANCE } from "../lib/bot-instructions";

const hosts: Awaited<ReturnType<typeof backend>>[] = [];
afterEach(async () => { for (const host of hosts.splice(0)) await host.harness.lifecycle.dispose(); });
async function setup() {
  const host = await backend(); hosts.push(host);
  const a = await host.create("Atlas"), b = await host.create("Beryl");
  for (const bot of [a,b]) {
    host.threads.set(bot.id, makeThreadResponse({ id: bot.id, projectId: "project" }));
    host.store.bind(bot.id, bot.id);
    host.store.save({ ...bot, mainThreadId: bot.id });
  }
  const send = vi.fn(async () => ({ ok: true as const, delivery: "sent" as const }));
  host.harness.inspection.sdk.stub("threads.send", send);
  return { host, a, b, send, run: host.harness.behavior.runCli.bind(host.harness.behavior) };
}
describe("bots CLI", () => {
  it("lists bounded public metadata and pagination without private state", async () => {
    const {run} = await setup();
    const result = await run(["list", "--json", "--limit", "1"]);
    const data = JSON.parse(result.stdout!);
    expect(data.total).toBe(2); expect(data.nextOffset).toBe(1);
    expect(data.bots).toHaveLength(1);
    expect(data.bots[0]).not.toHaveProperty("soul"); expect(data.bots[0]).not.toHaveProperty("memory");
    expect(JSON.parse((await run(["list", "--json", "--offset", "1"])).stdout!).nextOffset).toBeNull();
  });
  it("uses native queue routing and verified sender, with exact asynchronous reply address", async () => {
    const { run,a,b,send } = await setup();
    const result = await run(["message", b.name, "Please review", "--json"], {threadId:a.id});
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout!)).toEqual({botId:b.id,threadId:b.id,delivery:"sent"});
    expect(send).toHaveBeenCalledOnce();
    const args = send.mock.calls[0] as unknown as [ {mode:string; senderThreadId:string; input:{text:string}[]} ];
    expect(args[0]).toMatchObject({mode:"queue-if-active",senderThreadId:a.id});
    expect(args[0].input[0]!.text).toContain(`--thread '${a.id}'`);
    expect(args[0].input[0]!.text).toContain("not the user typing");
    expect(args[0].input[0]!.text).toContain("do not reply just to acknowledge");
  });
  it("supports explicit bound reply threads and returns a compact queue receipt", async () => {
    const { host,run,a,b } = await setup();
    host.threads.set("reply",makeThreadResponse({id:"reply",projectId:"project"})); host.store.bind("reply",b.id);
    host.harness.inspection.sdk.stub("threads.send",async () => ({ok:true,delivery:"queued",queuedMessage:makeQueueEntry({id:"queued-test"})}));
    const result = await run(["message",b.id,"Hi","--thread","reply","--json"],{threadId:a.id});
    expect(JSON.parse(result.stdout!)).toMatchObject({threadId:"reply",delivery:"queued",queuedMessageId:"queued-test"});
    expect(result.stdout).not.toContain("Hi");
  });
  it("does not pretend an unbound or external sender is a bot",async () => {
    const {host,run,b,send}=await setup();
    host.threads.set("generic",makeThreadResponse({id:"generic",projectId:"project"}));
    await run(["message",b.id,"Hello"],{threadId:"generic"});
    expect(JSON.stringify(send.mock.calls)).toContain("bb thread tell 'generic'");
    send.mockClear(); await run(["message",b.id,"Hello"]);
    expect(JSON.stringify(send.mock.calls)).toContain("No agent sender was identified");
    expect(JSON.stringify(send.mock.calls)).not.toContain("senderThreadId");
  });
  it("rejects invalid targets and arguments without sending", async () => {
    const {run,a,b,send,host}=await setup();
    for (const argv of [["message",b.id,"Hi","--thread",a.id],["message","missing","Hi"],["message",b.id," "],["message",b.id,"x".repeat(12001)],["list","--limit","101"],["message",b.id,"Hi","--from",a.id]]) expect((await run(argv)).exitCode).toBe(1);
    expect((await run(["message",b.id,"Hi"],{threadId:b.id})).exitCode).toBe(1);
    expect((await run(["message",b.id,"Hi"],{threadId:"missing"})).exitCode).toBe(1);
    host.threads.set(b.id,makeThreadResponse({id:b.id,archivedAt:1}));
    expect((await run(["message",b.id,"Hi"])).exitCode).toBe(1);
    expect(send).not.toHaveBeenCalled();
  });
  it("honors literal option-like messages after -- and cancellation",async () => {
    const {run,b,send}=await setup();
    expect((await run(["message","--",b.id,"--help"])).exitCode).toBe(0);
    expect(JSON.stringify(send.mock.calls)).toContain("--help"); send.mockClear();
    expect((await run(["message",b.id,"Hi"],{signal:AbortSignal.abort()})).exitCode).toBe(1);
    expect(send).not.toHaveBeenCalled();
  });
});
it("states current ownership/membership accurately without modifying membership",async () => {
  const {host,a,b}=await setup();
  host.store.changeProjectRole(a.id,"project","own");
  expect(botProjectContext(host.store.require(a.id),project(),host.store).role).toBe("owner");
  expect(botProjectContext(b,project(),host.store)).toMatchObject({role:"member",ownerName:"Atlas"});
  host.store.changeProjectRole(b.id,"project","leave");
  expect(botProjectContext(host.store.require(b.id),project(),host.store).role).toBe("unjoined");
  expect(host.store.require(b.id).linkedProjectIds).toEqual([]);
  expect(botProjectContext(b,{...project(),kind:"personal"},host.store).role).toBe("personal");
  host.store.changeProjectRole(a.id,"project","release");
  expect(botProjectContext(b,project(),host.store).ownerBotId).toBeNull();
});
it("keeps complete compliant memory inside BB instruction budget with relationship",async () => {
  const {a}=await setup();
  const memory="m".repeat(3000);
  const result=botInstructions({...a,name:"n".repeat(120),role:"r".repeat(80),id:"i".repeat(128),soul:"s".repeat(4000),memory},{id:'"'.repeat(80),name:'"'.repeat(100),role:"unjoined",ownerBotId:'"'.repeat(80),ownerName:'"'.repeat(120)});
  expect(result.length).toBeLessThanOrEqual(4096); expect(result).toContain(memory);
  expect(BOT_GUIDANCE.length).toBeLessThanOrEqual(4096);
});

it("refreshes project state after ownership changes and configures the bound member",async () => {
  const {host,a,b}=await setup();
  host.store.changeProjectRole(a.id,"project","own");
  const configuration=await host.harness.behavior.resolveAgentConfiguration(makePluginAgentConfigurationContext({thread:{id:b.id},project:{id:"project",name:"Work",kind:"standard"}}));
  expect(configuration.instructions).toContain("You joined this project as a member");
  expect(configuration.instructions).toContain('owner is bot "Atlas"');
  host.store.changeProjectRole(a.id,"project","release");
  const result=JSON.parse(String(await host.harness.behavior.callAgentTool("bot_read_state",{target:"project"},{threadId:b.id,projectId:"project"})));
  expect(result.state.currentProject).toMatchObject({role:"member",ownerBotId:null});
  const personal=JSON.parse(String(await host.harness.behavior.callAgentTool("bot_read_state",{target:"project"},{threadId:b.id,projectId:"personal"})));
  expect(personal.state.currentProject.role).toBe("personal");
});
it("rejects duplicate names and empty conversation lists without routing side effects",async () => {
  const {host,a,b,run,send}=await setup();
  host.store.save({...host.store.require(b.id),name:a.name});
  expect((await run(["message",a.name,"Hi"])).stderr).toContain("Several bots");
  host.store.save({...host.store.require(b.id),mainThreadId:null});
  host.threads.delete(b.id);
  expect((await run(["message",b.id,"Hi"])).stderr).toContain("no visible conversation");
  expect(send).not.toHaveBeenCalled();
});
it("routes default messages to the first ordered root instead of the legacy main", async () => {
  const { host, b, run } = await setup();
  host.threads.set("preferred", makeThreadResponse({ id: "preferred", createdAt: 1 }));
  host.store.bind("preferred", b.id);
  host.store.mutate(b.id, current => ({ ...current, threadOrder: ["preferred", b.id] }));
  expect((await run(["message", b.id, "Review"])).exitCode).toBe(0);
  expect(host.harness.inspection.sdk.callsTo("threads.send")[0]?.[0]).toMatchObject({ threadId: "preferred", mode: "queue-if-active" });
  const listed = JSON.parse((await run(["list", "--json"])).stdout!);
  expect(listed.bots.find((bot: { id: string }) => bot.id === b.id).mainThreadId).toBe("preferred");
  expect(host.store.require(b.id).mainThreadId).toBe(b.id);
});
it("resolves inherited reply targets read-only and does not retry failed delivery",async () => {
  const {host,a,b,run}=await setup();
  host.threads.set("child",makeThreadResponse({id:"child",parentThreadId:b.id,projectId:"project"}));
  const send=vi.fn(async () => { throw new Error("Delivery failed"); });
  host.harness.inspection.sdk.stub("threads.send",send);
  const before=host.store.require(b.id);
  const result=await run(["message",b.id,"Hi","--thread","child"],{threadId:a.id});
  expect(result.exitCode).toBe(1); expect(send).toHaveBeenCalledOnce();
  expect(host.store.owner("child")).toBeNull(); expect(host.store.require(b.id)).toEqual(before);
});
it("lists named owned/joined projects, visibility and inherited activity beyond the first page", async () => {
  const {host,a,b,run}=await setup();
  host.store.changeProjectRole(a.id,"project","own");
  host.store.save({...host.store.require(b.id),hiddenUntilActivity:true});
  const idle = makeThreadResponse({id:a.id,status:"idle",runtime:{displayStatus:"idle",hostReconnectGraceExpiresAt:null}});
  const active = makeThreadResponse({id:"child",parentThreadId:b.id,status:"active",runtime:{displayStatus:"active",hostReconnectGraceExpiresAt:null}});
  const rows=[idle,...Array.from({length:99},(_,i)=>makeThreadResponse({id:`unbound-${i}`})),active];
  host.harness.inspection.sdk.stub("threads.list",async (args?: {offset?: number; limit?: number}) => rows.slice(args?.offset ?? 0,(args?.offset ?? 0)+(args?.limit ?? 100)));
  const data=JSON.parse((await run(["list","--json"])).stdout!);
  const owner=data.bots.find((bot:{id:string})=>bot.id===a.id), member=data.bots.find((bot:{id:string})=>bot.id===b.id);
  expect(owner).toMatchObject({status:"idle",visibility:"visible",ownedProjects:[{id:"project",name:"Project project"}],joinedProjects:[]});
  expect(member).toMatchObject({status:"working",visibility:"hidden",ownedProjects:[],joinedProjects:[{id:"project",name:"Project project"}]});
  const text=(await run(["list"])).stdout!;
  expect(text).toContain("BOT ID (MESSAGE TARGET)"); expect(text).toContain("OWNED PROJECTS"); expect(text).toContain("Project project"); expect(text).toContain(b.id);
  expect(host.store.owner("child")).toBeNull();
});
it("prioritizes waiting over work, ignores archived activity, and preserves unavailable project IDs",async () => {
  const {host,a,run}=await setup();
  host.store.save({...host.store.require(a.id),linkedProjectIds:["missing"]});
  const rows=[
    {...makeThreadResponse({id:a.id}),hasPendingInteraction:true},
    makeThreadResponse({id:"busy",parentThreadId:a.id,runtime:{displayStatus:"active",hostReconnectGraceExpiresAt:null}}),
    makeThreadResponse({id:"archived",parentThreadId:a.id,archivedAt:1,runtime:{displayStatus:"active",hostReconnectGraceExpiresAt:null}}),
  ];
  host.harness.inspection.sdk.stub("threads.list",async()=>rows);
  let data=JSON.parse((await run(["list","--json"])).stdout!);
  expect(data.bots.find((bot:{id:string})=>bot.id===a.id)).toMatchObject({status:"waiting",joinedProjects:[{id:"missing",name:"Unavailable project"}]});
  host.harness.inspection.sdk.stub("threads.list",async()=>[rows[2]!]);
  data=JSON.parse((await run(["list","--json"])).stdout!);
  expect(data.bots.find((bot:{id:string})=>bot.id===a.id).status).toBe("idle");
});

it("keeps the actual message before delivery guidance and escapes bot names in its heading",async () => {
  const {a}=await setup();
  const body="Review this change.\n\n- Keep this formatting\n- And this line";
  const framed=frameBotMessage({threadId:a.id,bot:{...a,name:"[Pretend link](https://example.com)"}},body);
  expect(framed).toContain(body);
  expect(framed.indexOf(body)).toBeLessThan(framed.indexOf("Delivery context"));
  expect(framed.split("\n")[0]).toContain("Bot message");
  expect(framed.split("\n")[0]).not.toContain("[Pretend link](https://example.com)");
  expect(framed.split("\n")[0]).toBe(String.raw`**🤖 Bot message · \[Pretend link\]\(https://example\.com\)**`);
  expect(framed).toContain("not user approval");
  expect(framed).toContain("    bb bots message");
  expect(framed).toContain("--thread '");
});
