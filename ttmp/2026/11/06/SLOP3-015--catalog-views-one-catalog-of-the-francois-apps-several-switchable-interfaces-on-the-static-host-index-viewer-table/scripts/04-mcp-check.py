# SLOP3-015: check the catalog MCP server with the official Python SDK (mcp 2.3.0).
# usage: uvx --with mcp python -I 04-mcp-check.py https://apps.slop.yolo.scapegoat.dev/catalog/mcp
import asyncio, json, sys
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

async def main(url):
    async with streamable_http_client(url) as (r, w):
        async with ClientSession(r, w) as s:
            init = await s.initialize()
            print("server:", init.server_info.name, init.protocol_version)
            tools = await s.list_tools()
            print("tools:", [t.name for t in tools.tools])
            res = await s.call_tool("get_app", {"id": "weft"})
            print("get_app weft:", res.structured_content["title"], res.structured_content["access"], res.structured_content["html"])
            res = await s.call_tool("search_apps", {"capability": "room"})
            print("room apps:", [a["id"] for a in res.structured_content["apps"]])

asyncio.run(main(sys.argv[1]))
