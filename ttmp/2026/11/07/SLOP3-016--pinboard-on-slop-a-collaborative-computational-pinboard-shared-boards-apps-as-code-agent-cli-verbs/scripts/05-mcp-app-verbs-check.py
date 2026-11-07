# SLOP3-016 phase 5b: Pinboard's verbs as MCP tools, with the official SDK.
# The token comes from the local server's credentials file and is never printed.
import asyncio, json, sys
import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

async def main(url, creds, store):
    token = json.load(open(creds))["servers"]["http://slop.localhost:18300"]["token"]
    client = httpx.AsyncClient(headers={"Authorization": "Bearer " + token}, timeout=30)
    async with streamable_http_client(url, http_client=client) as (r, w, *_):
        async with ClientSession(r, w) as s:
            init = await s.initialize()
            print("server:", init.server_info.name, init.protocol_version)
            tools = (await s.list_tools()).tools
            pb = sorted(t.name for t in tools if t.name.startswith("pb_"))
            print("pb tools:", pb)
            add = next(t for t in tools if t.name == "pb_clip_add")
            print("pb_clip_add required:", add.input_schema.get("required"), "props:", sorted(add.input_schema["properties"]))
            res = await s.call_tool("pb_clip_add", {"store": store, "text": "added through MCP (python sdk)", "tags": ["mcp"]})
            print("pb_clip_add isError:", res.is_error, "kind:", (res.structured_content or {}).get("result", {}).get("kind"))
            res = await s.call_tool("pb_board_describe", {"store": store})
            text = (res.structured_content or {}).get("result", "")
            print("pb_board_describe isError:", res.is_error, "| first line:", text.splitlines()[0] if text else None, "| mentions it:", "added through MCP" in text)
            res = await s.call_tool("pb_clip_ls", {"store": store, "tag": "mcp"})
            rows = (res.structured_content or {}).get("result") or []
            print("pb_clip_ls tag=mcp:", len(rows), "rows")
            res = await s.call_tool("pb_clip_add", {"store": store, "colour": "red"})
            print("bad value -> isError:", res.is_error, res.content[0].text[:80])
            res = await s.call_tool("pb_board_log", {"store": store, "limit": 3})
            print("log mentions (mcp):", "(mcp)" in json.dumps(res.structured_content))
    await client.aclose()

asyncio.run(main(*sys.argv[1:]))
