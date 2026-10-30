# LLM chat (example app)

A chat page on the `sample` capability: multi-turn history, streaming,
a model and effort picker filled from `sample.limits()`, three page tools
(`get_time`, `roll_dice`, `calculate`) and Stop. Tool calls and their
results are kept in the stored assistant turns, because turns are plain
text: a later turn only knows what earlier turns say.

## Run it locally

```bash
# 1. Build slop with the Workshop embedded.
make build                       # or: go generate ./pkg/web && go build -tags embed -o slop ./cmd/slop

# 2. Serve in local mode with Pi's models (reads ~/.pi/agent).
./slop serve --local --listen 127.0.0.1:8080 \
  --database-url sqlite:/tmp/slop-dev/slop.db --blobs /tmp/slop-dev/blobs \
  --models pi \
  --model-quick lunaroute/glm-5.3-flash --model-default lunaroute/glm-5.3 --model-complex lunaroute/deepseek-4.1-flash

# 3. Get a token once (local mode), then push the app.
./slop auth login --server http://127.0.0.1:8080 --as manuel
./slop push web/examples/llm-chat -a llm-chat --server http://127.0.0.1:8080

# 4. Open http://127.0.0.1:8080/run/llm-chat, pick a nickname, allow "sample".
```

`--models pi` needs no Node. Without the tier flags every tier is Pi's
default model. Only admins may sample; in local mode every user is one.
Edit `index.html` and run `slop push … --watch` to republish on save.
