# Snowflake.CortexAI.AgentAction

GitHub Action that sends prompts to a Snowflake Cortex Agent. It captures the final response plus all streamed events so downstream workflow steps can parse the answer or inspect the reasoning trace.

## Inputs & Environment

| Input / Env | Required? | Description |
|-------------|-----------|-------------|
| `agent-name` / `AGENT_NAME` | ✅ | Agent object name (e.g. `EMPLOYEE_AGENT`). |
| `message` / `AGENT_MESSAGE` | ✅* | Single user message when `messages` isn’t provided. |
| `messages` / `AGENT_MESSAGES` | ✅* | JSON array of Cortex Agent messages (include history + current turn). Takes precedence over `message`. |
| `SNOWFLAKE_ACCOUNT_URL`, `SNOWFLAKE_PAT` **or** `SNOWFLAKE_PASSWORD` | ✅ | Credentials used to authenticate with the Cortex Agents REST API. |
| `agent-database` / `AGENT_DATABASE` / `SNOWFLAKE_DATABASE` |  | Database containing the agent object (inputs override env; falls back to `AGENT_DATABASE` or `SNOWFLAKE_DATABASE`). |
| `agent-schema` / `AGENT_SCHEMA` / `SNOWFLAKE_SCHEMA` |  | Schema containing the agent object (inputs override env; falls back to `AGENT_SCHEMA` or `SNOWFLAKE_SCHEMA`). |
| `thread-id` / `AGENT_THREAD_ID` |  | Integer thread identifier when continuing a conversation. |
| `parent-message-id` / `AGENT_PARENT_MESSAGE_ID` |  | Parent message id paired with `thread-id`. |
| `tool-choice` / `AGENT_TOOL_CHOICE` |  | JSON object controlling tool selection (defaults to auto). Plain strings such as `auto` are converted into `{ "type": "auto" }`. |
| `persist-results` / `AGENT_PERSIST_RESULTS` |  | `true/false` (default `false`). When true, writes the response JSON to disk instead of printing it. |
| `persist-dir` / `AGENT_PERSIST_DIR` |  | Directory where persisted JSON files are stored (defaults to `RUNNER_TEMP`). |

## Basic usage

```yaml
- name: Ask the Employee Agent
  uses: marcelinojackson-org/Snowflake.CortexAI.AgentAction@v1
  with:
    agent-name: 'EMPLOYEE_AGENT'
    message: 'employees who joined the company in the last 180 days'
  env:
    SNOWFLAKE_ACCOUNT_URL: ${{ secrets.SNOWFLAKE_ACCOUNT_URL }}
    SNOWFLAKE_PAT: ${{ secrets.SNOWFLAKE_PAT }}
    AGENT_DATABASE: ${{ vars.AGENT_DATABASE }}
    AGENT_SCHEMA: ${{ vars.AGENT_SCHEMA }}
    AGENT_PERSIST_RESULTS: 'true'
    AGENT_PERSIST_DIR: ${{ runner.temp }}
```

## Advanced usage

```yaml
- name: Multi-turn Cortex Agent conversation
  id: cortex-agent
  uses: marcelinojackson-org/Snowflake.CortexAI.AgentAction@v1
  with:
    agent-name: ${{ vars.AGENT_NAME }}
    messages: >
      [
        {
          "role": "user",
          "content": [
            {
              "type": "text",
              "text": "ROLE:MANAGER Summarize employees who joined in the last 180 days. Provide overall totals, top regions, and at most five sample employees."
            }
          ]
        }
      ]
    tool-choice: '{"type":"auto","name":["Employee_Details_With_Salary-Analyst","EMPLOYEE_DOCS-SEARCH"]}'
  env:
    SNOWFLAKE_ACCOUNT_URL: ${{ secrets.SNOWFLAKE_ACCOUNT_URL }}
    SNOWFLAKE_PAT: ${{ secrets.SNOWFLAKE_PAT }}
    AGENT_DATABASE: ${{ vars.AGENT_DATABASE }}
    AGENT_SCHEMA: ${{ vars.AGENT_SCHEMA }}
    AGENT_PERSIST_RESULTS: 'true'
    AGENT_PERSIST_DIR: ${{ runner.temp }}

- name: Inspect agent outputs
  run: |
    echo "Answer text:\n${{ steps.cortex-agent.outputs.answer-text }}"
    echo 'Events:'
    echo '${{ steps.cortex-agent.outputs.events-json }}' | jq .
    echo "Response file path: ${{ steps.cortex-agent.outputs.result-file }}"
    jq . '${{ steps.cortex-agent.outputs.result-file }}'
```

## Outputs

| Output | Description |
|--------|-------------|
| `result-json` | Final `response` event emitted by the agent (stringified JSON). |
| `answer-text` | First text segment extracted from the response (if available). |
| `events-json` | Array of `{ event, data }` for every streamed event. |
| `result-file` | File path containing the persisted response JSON when `persist-results=true`. |

Set `persist-results: true` (or `AGENT_PERSIST_RESULTS=true`) when you want to avoid dumping large JSON blobs in logs—the action will save the payload under `persist-dir` (defaults to `RUNNER_TEMP`), print only the file path, and automatically prune files older than 24 hours. Filenames are timestamped (`agent-result-YYYYMMDD-HHMMSS-epoch.json`) so you can keep the freshest artifacts.
