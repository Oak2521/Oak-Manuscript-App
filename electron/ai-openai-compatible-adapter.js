"use strict";

const SUPPORTED_PROVIDERS = Object.freeze([
  "openai_compatible", "ollama", "lm_studio",
]);

function plain(value) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function buildRequest(configuration, request) {
  const headers = configuration.credential === null
    ? {}
    : { authorization: `Bearer ${configuration.credential}` };
  return {
    url: `${configuration.base_url}/chat/completions`,
    headers,
    json: {
      model: configuration.model,
      messages: [
        { role: "system", content: request.system_instruction },
        {
          role: "user",
          content: `${request.user_instruction}\n\n当前单条问题上下文（JSON）：\n${JSON.stringify(request.issue_context)}`,
        },
      ],
      stream: false,
    },
  };
}

function parseResponse(value) {
  if (!plain(value) || !Array.isArray(value.choices) || value.choices.length !== 1) {
    throw new TypeError("OpenAI-compatible 响应 choices 非法");
  }
  const choice = value.choices[0];
  if (!plain(choice) || !plain(choice.message) ||
      (choice.message.role !== undefined && choice.message.role !== "assistant") ||
      (Object.hasOwn(choice.message, "tool_calls") &&
        (!Array.isArray(choice.message.tool_calls) || choice.message.tool_calls.length !== 0)) ||
      (choice.finish_reason !== undefined && choice.finish_reason !== "stop") ||
      typeof choice.message.content !== "string" || choice.message.content.trim().length === 0) {
    throw new TypeError("OpenAI-compatible 响应消息非法");
  }
  return { text: choice.message.content };
}

function parseLmStudioResponse(value, configuration) {
  if (!plain(configuration) || typeof configuration.model !== "string" ||
      !plain(value) || value.model !== configuration.model) {
    throw new TypeError("LM Studio 响应模型标识与请求不符");
  }
  return parseResponse(value);
}

function createOpenAICompatibleAdapters() {
  const adapter = Object.freeze({ buildRequest, parseResponse });
  const lmStudioAdapter = Object.freeze({ buildRequest, parseResponse: parseLmStudioResponse });
  return new Map([
    ["openai_compatible", adapter],
    ["ollama", adapter],
    ["lm_studio", lmStudioAdapter],
  ]);
}

module.exports = {
  SUPPORTED_PROVIDERS,
  buildRequest,
  createOpenAICompatibleAdapters,
  parseLmStudioResponse,
  parseResponse,
};
