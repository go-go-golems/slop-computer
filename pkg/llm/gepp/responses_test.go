package gepp

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/go-go-golems/slop-computer/pkg/llm"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// responses streams OpenAI Responses server-sent events, each a {name, data} pair.
func responses(events ...[2]string) func(w http.ResponseWriter) {
	return func(w http.ResponseWriter) {
		w.Header().Set("Content-Type", "text/event-stream")
		for _, e := range events {
			_, _ = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", e[0], e[1])
		}
	}
}

func responsesText(id, text string) [][2]string {
	return [][2]string{
		{"response.output_item.added", `{"output_index":0,"item":{"type":"message","id":"` + id + `","status":"in_progress"}}`},
		{"response.output_text.delta", `{"output_index":0,"item_id":"` + id + `","delta":` + mustJSON(text) + `}`},
		{"response.output_item.done", `{"output_index":0,"item":{"type":"message","id":"` + id + `","status":"completed","content":[{"type":"output_text","text":` + mustJSON(text) + `}]}}`},
	}
}

func mustJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

// A model whose Pi entry says api: openai-responses (lunaroute's default)
// goes through Geppetto's Responses engine. Two bugs there broke the bench's
// agent on lunaroute/deepseek: the tools were not sent (the model wrote its
// calls as text), and earlier assistant turns were sent in a form the
// gateway rejects. This pins both through slop's own rounds.
func TestResponsesAPISendsToolsAndValidHistory(t *testing.T) {
	round1 := append(responsesText("msg_1", "Let me check."),
		[2]string{"response.output_item.added", `{"output_index":1,"item":{"type":"function_call","id":"fc_1","call_id":"call_1","name":"get_weather"}}`},
		[2]string{"response.function_call_arguments.delta", `{"output_index":1,"item_id":"fc_1","delta":"{\"city\":\"Oslo\"}"}`},
		[2]string{"response.output_item.done", `{"output_index":1,"item":{"type":"function_call","id":"fc_1","call_id":"call_1","name":"get_weather","arguments":"{\"city\":\"Oslo\"}","status":"completed"}}`},
		[2]string{"response.completed", `{"response":{"usage":{"input_tokens":12,"output_tokens":5}}}`})
	round2 := append(responsesText("msg_2", "Oslo 17."),
		[2]string{"response.completed", `{"response":{"usage":{"input_tokens":30,"output_tokens":3}}}`})
	b, p := setupAPI(t, "openai-responses", nil, responses(round1...), responses(round2...))

	exec := func(context.Context, llm.Event) (llm.ToolResult, error) {
		return llm.ToolResult{Value: json.RawMessage(`{"temp":17}`)}, nil
	}
	history := `[{"role":"user","content":"Say ping."},{"role":"assistant","content":"ping"},{"role":"user","content":"Weather in Oslo?"}]`
	rec := &recorder{}
	require.NoError(t, b.Sample(context.Background(), req(history, llm.Options{}, weather), rec.emit, exec))
	assert.Equal(t, "Let me check.\n\nOslo 17.", rec.last("result").Result.Text)

	require.Len(t, p.bodies, 2)
	tools, _ := p.bodies[0]["tools"].([]any)
	require.Len(t, tools, 1, "the round's tools are sent")
	tool := tools[0].(map[string]any)
	assert.Equal(t, "function", tool["type"])
	assert.Equal(t, "get_weather", tool["name"])

	// Every assistant message is either plain string content or a complete
	// output item (id and status); never an id-less output_text list.
	for i, body := range p.bodies {
		for _, it := range body["input"].([]any) {
			item := it.(map[string]any)
			if item["role"] != "assistant" {
				continue
			}
			if _, isString := item["content"].(string); isString {
				continue
			}
			assert.NotEmpty(t, item["id"], "request %d: assistant list content needs an id: %v", i, item)
			assert.Equal(t, "completed", item["status"], "request %d: assistant list content needs a status: %v", i, item)
		}
	}
	first := p.bodies[0]["input"].([]any)
	assert.Equal(t, "ping", first[1].(map[string]any)["content"], "the earlier assistant turn goes out as string content")

	var call, output map[string]any
	for _, it := range p.bodies[1]["input"].([]any) {
		switch item := it.(map[string]any); item["type"] {
		case "function_call":
			call = item
		case "function_call_output":
			output = item
		}
	}
	require.NotNil(t, call, "round 2 replays the call")
	require.NotNil(t, output, "round 2 sends the result")
	assert.Equal(t, "call_1", call["call_id"])
	assert.Equal(t, "call_1", output["call_id"])
	assert.JSONEq(t, `{"temp":17}`, output["output"].(string))
}
