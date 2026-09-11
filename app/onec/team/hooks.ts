import { useCallback, useEffect, useState } from "react";
import type { MarginAnalyticsResponse } from "../sales/types";
import type { SellerPayload } from "../types";
import {
  fetchTeamData,
  fetchTeamPlan,
  updateTeamPlan,
} from "./api";
import type { Period, SalesChannel } from "./types";

type TeamQuery = {
  storeKey: string;
  period: Period;
  channel: SalesChannel;
};

export function useTeamData({ storeKey, period, channel }: TeamQuery) {
  const [payload, setPayload] = useState<SellerPayload>({});
  const [margin, setMargin] = useState<
    MarginAnalyticsResponse["items"] | null
  >(null);
  const [marginError, setMarginError] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        setLoading(true);
        setError("");
        setMarginError("");

        const result = await fetchTeamData(
          { storeKey, period, channel },
          controller.signal,
        );

        setPayload(result.payload);
        setMargin(result.margin);
        setMarginError(result.marginError);
      } catch (cause) {
        if (!isAbortError(cause)) {
          setError(
            errorMessage(cause, "Не удалось получить продажи из 1С"),
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => controller.abort();
  }, [channel, period, storeKey]);

  return {
    payload,
    margin,
    marginError,
    loading,
    error,
  };
}

export function useTeamPlan({ storeKey, period, channel }: TeamQuery) {
  const [plan, setPlan] = useState(0);
  const [planInput, setPlanInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        setLoading(true);
        setMessage("");

        const amount = await fetchTeamPlan(
          { storeKey, period, channel },
          controller.signal,
        );

        setPlan(amount);
        setPlanInput(amount ? String(amount) : "");
      } catch (cause) {
        if (!isAbortError(cause)) {
          setMessage(
            errorMessage(cause, "Не удалось загрузить план команды"),
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => controller.abort();
  }, [channel, period, storeKey]);

  const save = useCallback(async () => {
    const amount = Number(planInput.replace(",", "."));

    if (!Number.isFinite(amount) || amount < 0) {
      setMessage("Укажите корректную сумму плана");
      return;
    }

    try {
      setSaving(true);
      setMessage("");

      const savedAmount = await updateTeamPlan(
        { storeKey, period, channel },
        amount,
      );

      setPlan(savedAmount);
      setPlanInput(savedAmount ? String(savedAmount) : "");
      setMessage("План команды сохранён");
    } catch (cause) {
      setMessage(
        errorMessage(cause, "Не удалось сохранить план команды"),
      );
    } finally {
      setSaving(false);
    }
  }, [channel, period, planInput, storeKey]);

  return {
    plan,
    planInput,
    setPlanInput,
    loading,
    saving,
    message,
    save,
  };
}

function isAbortError(cause: unknown) {
  return cause instanceof DOMException && cause.name === "AbortError";
}

function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback;
}
