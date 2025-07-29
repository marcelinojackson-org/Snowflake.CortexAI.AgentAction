import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';
import { CortexAgentMessage, runCortexAgent } from '@marcelinojackson-org/snowflake-common';

type ToolChoiceInput = Record<string, unknown> | string | undefined;

async function main(): Promise<void> {
  try {
    const coords = resolveAgentCoordinates();
    const messages = parseMessages(
      core.getInput('messages') || process.env.AGENT_MESSAGES,
      core.getInput('message') || process.env.AGENT_MESSAGE
    );

    const threadId = parseOptionalInteger(core.getInput('thread-id') || process.env.AGENT_THREAD_ID);
    const parentMessageId = parseOptionalInteger(core.getInput('parent-message-id') || process.env.AGENT_PARENT_MESSAGE_ID);
    const toolChoice = parseToolChoice(core.getInput('tool-choice') || process.env.AGENT_TOOL_CHOICE);
    const persistResults = parseBoolean(core.getInput('persist-results') || process.env.AGENT_PERSIST_RESULTS);
    const persistDir =
      core.getInput('persist-dir') ||
      process.env.AGENT_PERSIST_DIR ||
      process.env.RUN_SQL_RESULT_DIR ||
      process.env.RUNNER_TEMP ||
      process.cwd();

    const result = await runCortexAgent({
      database: coords.database,
      schema: coords.schema,
      agentName: coords.agentName,
      messages,
      threadId,
      parentMessageId,
      toolChoice
    });

    console.log('Cortex Agent run succeeded ✅');
    console.log(`Agent: ${coords.database}.${coords.schema}.${coords.agentName}`);
    let persistedPath: string | undefined;
    if (persistResults) {
      persistedPath = persistResponse(result.response, persistDir);
      console.log(`Response JSON persisted to ${persistedPath}`);
    } else {
      console.log('Response JSON:', JSON.stringify(result.response, null, 2));
    }
    if (persistResults && persistedPath) {
      emitOutput('result-json', JSON.stringify({ persisted: true, path: persistedPath }));
      emitOutput('result-file', persistedPath);
    } else {
      emitOutput('result-json', JSON.stringify(result.response ?? {}));
      emitOutput('result-file', '');
    }
    emitOutput('events-json', JSON.stringify(result.events));

    const answerText = extractAnswerText(result.response);
    if (answerText) {
      console.log('Answer:');
      console.log(answerText);
      emitOutput('answer-text', answerText);
    }
  } catch (error) {
    console.error('Cortex Agent run failed:');
    if (error instanceof Error) {
      console.error(error.stack ?? error.message);
      core.setFailed(error.message);
    } else {
      console.error(error);
      core.setFailed('Unknown error when running Cortex Agent');
    }
  }
}

function resolveAgentCoordinates(): { database: string; schema: string; agentName: string } {
  const database =
    (core.getInput('agent-database') || process.env.AGENT_DATABASE || process.env.SNOWFLAKE_DATABASE || '').trim();
  const schema =
    (core.getInput('agent-schema') || process.env.AGENT_SCHEMA || process.env.SNOWFLAKE_SCHEMA || '').trim();
  const agentName = (core.getInput('agent-name') || process.env.AGENT_NAME || '').trim();

  if (!database) {
    throw new Error('Provide `agent-database` or set AGENT_DATABASE/SNOWFLAKE_DATABASE.');
  }
  if (!schema) {
    throw new Error('Provide `agent-schema` or set AGENT_SCHEMA/SNOWFLAKE_SCHEMA.');
  }
  if (!agentName) {
    throw new Error('Provide `agent-name` or set AGENT_NAME.');
  }

  return { database, schema, agentName };
}

function parseMessages(rawMessages?: string, fallbackMessage?: string): CortexAgentMessage[] {
  if (rawMessages && rawMessages.trim().length > 0) {
    try {
      const parsed = JSON.parse(rawMessages);
      if (!Array.isArray(parsed)) {
        throw new Error('messages must be a JSON array.');
      }
      return parsed as CortexAgentMessage[];
    } catch (err) {
      throw new Error(`Invalid messages JSON: ${(err as Error).message}`);
    }
  }

  const single = (fallbackMessage || '').trim();
  if (!single) {
    throw new Error('Provide `message` input, AGENT_MESSAGE env, or a messages array.');
  }

  return [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: single
        }
      ]
    }
  ];
}

function parseOptionalInteger(raw?: string): number | undefined {
  if (!raw) {
    return undefined;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  const num = Number(trimmed);
  if (Number.isNaN(num)) {
    throw new Error(`Expected integer value, received: ${raw}`);
  }
  return Math.floor(num);
}

const isGitHubEnv = Boolean(process.env.GITHUB_OUTPUT || process.env.GITHUB_ACTIONS);
const MAX_PERSIST_FILE_AGE_MS = 24 * 60 * 60 * 1000; // 1 day

function parseToolChoice(raw?: string): ToolChoiceInput {
  if (!raw) {
    return undefined;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('tool-choice must be a JSON object.');
      }
      return parsed as Record<string, unknown>;
    } catch (err) {
      throw new Error(`Invalid tool-choice JSON: ${(err as Error).message}`);
    }
  }

  return { type: trimmed };
}

function parseBoolean(raw?: string): boolean {
  if (!raw) {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function persistResponse(payload: unknown, dir: string): string {
  const resolvedDir = path.resolve(dir);
  fs.mkdirSync(resolvedDir, { recursive: true });
  cleanupPersistedFiles(resolvedDir, MAX_PERSIST_FILE_AGE_MS);
  const now = new Date();
  const datestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
    now.getDate()
  ).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(
    now.getSeconds()
  ).padStart(2, '0')}`;
  const filePath = path.join(resolvedDir, `agent-result-${datestamp}-${now.getTime()}.json`);
  fs.writeFileSync(filePath, JSON.stringify(payload ?? {}, null, 2), 'utf-8');
  return filePath;
}

function emitOutput(name: string, value: string): void {
  if (isGitHubEnv) {
    core.setOutput(name, value);
  }
}

function cleanupPersistedFiles(dir: string, maxAgeMs: number): void {
  if (!fs.existsSync(dir)) {
    return;
  }
  const now = Date.now();
  for (const entry of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    try {
      const stats = fs.statSync(fullPath);
      if (!stats.isFile()) {
        continue;
      }
      if (now - stats.mtimeMs > maxAgeMs) {
        fs.unlinkSync(fullPath);
      }
    } catch {
      // ignore errors during cleanup
    }
  }
}

function extractAnswerText(payload: unknown): string | undefined {
  if (!payload || payload === null) {
    return undefined;
  }

  if (typeof payload === 'string') {
    return payload.trim() ? payload : undefined;
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const nested = extractAnswerText(item);
      if (nested) {
        return nested;
      }
    }
    return undefined;
  }

  if (typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.content)) {
      const textParts = record.content
        .map((entry) =>
          entry && typeof entry === 'object' && typeof (entry as Record<string, unknown>).text === 'string'
            ? ((entry as Record<string, unknown>).text as string)
            : undefined
        )
        .filter((value): value is string => typeof value === 'string' && value.length > 0);
      if (textParts.length > 0) {
        return textParts.join('\n');
      }
    }
    if (typeof record.text === 'string' && record.text.trim().length > 0) {
      return record.text;
    }
    if (record.response) {
      const nested = extractAnswerText(record.response);
      if (nested) {
        return nested;
      }
    }
    if (record.data) {
      const nested = extractAnswerText(record.data);
      if (nested) {
        return nested;
      }
    }
  }

  return undefined;
}

void main();
