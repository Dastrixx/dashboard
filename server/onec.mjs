function getConfig() {
  return {
    baseUrl: process.env.ONEC_ODATA_URL?.replace(/\/$/, ""),
    username: process.env.ONEC_USER,
    password: process.env.ONEC_PASSWORD,
    timeoutMs: Number(process.env.ONEC_TIMEOUT_MS || 20_000),
  };
}

function getAuthorization(username, password) {
  const token = Buffer.from(`${username}:${password}`, "utf8").toString(
    "base64",
  );

  return `Basic ${token}`;
}

async function onecRequest(path, params = {}, accept = "application/json") {
  const { baseUrl, username, password, timeoutMs } = getConfig();

  if (!baseUrl || !username || !password) {
    throw new Error(
      "Заполни ONEC_ODATA_URL, ONEC_USER и ONEC_PASSWORD в файле .env",
    );
  }

  const normalizedPath = String(path).replace(/^\/+/, "");
  const url = new URL(`${baseUrl}/${normalizedPath}`);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    headers: {
      Authorization: getAuthorization(username, password),
      Accept: accept,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });

  const body = await response.text();

  if (!response.ok) {
    const details = body.replace(/\s+/g, " ").trim().slice(0, 800);
    throw new Error(
      `1С OData вернула HTTP ${response.status}${details ? `: ${details}` : ""}`,
    );
  }

  if (accept.includes("xml")) {
    return body;
  }

  try {
    const data = JSON.parse(body);
    return data.value ?? data;
  } catch {
    throw new Error("1С вернула некорректный JSON");
  }
}

export function onecMetadata() {
  return onecRequest("$metadata", {}, "application/xml");
}

export function onecGet(entity, params = {}) {
  if (!/^[\p{L}\p{N}_]+$/u.test(entity)) {
    throw new Error("Недопустимое имя сущности 1С");
  }

  return onecRequest(entity, {
    $format: "json",
    ...params,
  });
}


export function onecGetByKey(entity, key, params = {}) {
  if (!/^[\p{L}\p{N}_]+$/u.test(entity)) {
    throw new Error("Недопустимое имя сущности 1С");
  }

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      key,
    )
  ) {
    throw new Error("Недопустимый ключ сущности 1С");
  }

  return onecRequest(`${entity}(guid'${key}')`, {
    $format: "json",
    ...params,
  });
}
