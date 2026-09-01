export function success(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function errorCode(error) {
  if (typeof error?.code === "string" && error.code) return error.code;
  if (error instanceof TypeError) return "INVALID_INPUT_OR_SOURCE";
  return "MCP_OPERATION_FAILED";
}

export function failure(error, auditContext) {
  const value = {
    status: "error",
    error: {
      code: errorCode(error),
      message: error instanceof Error ? error.message : "Unknown MCP operation failure",
    },
    ...(auditContext ? { auditContext } : {}),
  };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

export function safeTool(handler, auditContextForInput) {
  return async (input) => {
    let auditContext;
    try {
      auditContext = auditContextForInput?.(input);
      return success(await handler(input, auditContext));
    } catch (error) {
      return failure(error, auditContext);
    }
  };
}

export const READ_ONLY_LOCAL = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export const READ_ONLY_INTERACTIVE = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};
