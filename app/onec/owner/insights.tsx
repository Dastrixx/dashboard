import { BadgePercent, CircleAlert, Gift, TrendingDown, TrendingUp } from "lucide-react";
import type { CheckAnalytics } from "../sales/types";
import type { Period } from "../types";
import { money, periodLabel } from "./format";
import type { OwnerOverviewAnalytics } from "./types";

type Insight = {
  tone: "good" | "warn" | "neutral";
  title: string;
  description: string;
  icon: typeof TrendingUp;
};

export function ImportantInsights({
  analytics,
  checks,
  checksError,
  period,
}: {
  analytics: OwnerOverviewAnalytics;
  checks: CheckAnalytics | null;
  checksError: string;
  period: Period;
}) {
  const insights: Insight[] = [];
  const growth = analytics.period.revenueGrowth;

  if (growth !== null) {
    insights.push({
      tone: growth >= 0 ? "good" : "warn",
      title: growth >= 0 ? "Выручка растёт" : "Выручка снизилась",
      description: `${Math.abs(growth).toFixed(1)}% относительно предыдущего периода такой же длины.`,
      icon: growth >= 0 ? TrendingUp : TrendingDown,
    });
  }

  const leader = analytics.categories[0];
  if (leader) {
    insights.push({
      tone: "good",
      title: `Лидер — ${leader.label}`,
      description: `${leader.share.toFixed(1)}% выручки, ${money.format(leader.revenue)} за ${periodLabel[period]}.`,
      icon: TrendingUp,
    });
  }

  if (checks) {
    insights.push({
      tone: checks.current.discountShare > 10 ? "warn" : "neutral",
      title: "Скидки под контролем",
      description: `${checks.current.discountShare.toFixed(1)}% от суммы до скидок — ${money.format(checks.current.discounts)}.`,
      icon: BadgePercent,
    });

    if (checks.current.certificatePayments || checks.current.certificatesUsed) {
      insights.push({
        tone: "neutral",
        title: "Использованы сертификаты",
        description: `${money.format(checks.current.certificatePayments)}, погашений: ${checks.current.certificatesUsed}.`,
        icon: Gift,
      });
    }
  } else if (checksError) {
    insights.push({
      tone: "warn",
      title: "Чеки временно недоступны",
      description: "Продажи показаны по розничным отчётам; средний чек и скидки обновятся после ответа 1С.",
      icon: CircleAlert,
    });
  }

  return (
    <article className="panel owner-insights-panel">
      <div className="owner-panel-head">
        <div>
          <span className="onec-source-kicker">Краткая сводка</span>
          <h2>Что важно знать</h2>
          <p>Главные изменения без деталей склада и команды</p>
        </div>
      </div>
      <div className="owner-insight-list">
        {insights.slice(0, 4).map((insight) => {
          const Icon = insight.icon;
          return (
            <div className={`owner-insight ${insight.tone}`} key={insight.title}>
              <Icon size={18} aria-hidden />
              <div>
                <strong>{insight.title}</strong>
                <span>{insight.description}</span>
              </div>
            </div>
          );
        })}
      </div>
    </article>
  );
}
