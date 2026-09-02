"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeftRight,
  Boxes,
  ChartNoAxesCombined,
  Globe2,
  Home,
  LogOut,
  Menu,
  PackageSearch,
  Users,
  X,
} from "lucide-react";
import { OnecSales } from "./onec-sales";
import {
  AuthError,
  getCurrentUser,
  logout as endSession,
  type AuthUser,
} from "./auth-client";
import {
  OnecOverview,
  OnecProcurement,
  OnecStock,
  OnecTeam,
} from "./onec-workspaces";
import {
  dashboardRoute,
  DEFAULT_DASHBOARD_ROUTE,
  NAVIGATION,
  type Role,
  type Section,
} from "./dashboard-routes";
type Period = 7 | 30 | 90;
type OwnerDateRange = { from: string; to: string };

function Icon({ name }: { name: string }) {
  const icons: Record<string, typeof Home> = {
    overview: Home,
    products: PackageSearch,
    stock: Boxes,
    team: Users,
    procurement: ArrowLeftRight,
    online: Globe2,
  };
  const Component = icons[name] || ChartNoAxesCombined;
  return <Component className="icon" aria-hidden strokeWidth={1.8} />;
}

function Online() {
  return (
    <section className="phase-card">
      <div className="phase-icon">↗</div>
      <span className="tag green">PHASE 2</span>
      <h2>Онлайн-продажи и посещаемость</h2>
      <p>
        Источник онлайн-продаж пока не подключён. Демо-показатели отключены:
        после интеграции CRM или интернет-магазина здесь появятся реальные
        посетители, заказы, конверсия и каналы трафика.
      </p>
      <div className="future-grid">
        <div><b>—</b><span>Посетители сайта</span></div>
        <div><b>—</b><span>Заказы онлайн</span></div>
        <div><b>—</b><span>Конверсия</span></div>
        <div><b>—</b><span>Каналы трафика</span></div>
      </div>
      <button className="secondary">Нет подключённого источника</button>
    </section>
  );
}

export function Dashboard({
  initialRole,
  initialSection,
  initialUser,
}: {
  initialRole: Role;
  initialSection: Section;
  initialUser: AuthUser;
}) {
  const router = useRouter();
  const role = initialRole;
  const [session, setSession] = useState<AuthUser | null>(initialUser);
  const [menuOpen, setMenuOpen] = useState(false);
  const [period, setPeriod] = useState<Period>(30);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [ownerDateRange, setOwnerDateRange] = useState<OwnerDateRange | null>(null);

  const canApplyOwnerRange =
    Boolean(dateFrom && dateTo) && dateFrom <= dateTo;

  const applyOwnerRange = () => {
    if (!canApplyOwnerRange) return;
    setOwnerDateRange({ from: dateFrom, to: dateTo });
  };

  const useOwnerPreset = (value: Period) => {
    setPeriod(value);
    setOwnerDateRange(null);
  };

  useEffect(() => {
    const controller = new AbortController();
    const verifySession = async () => {
      try {
        const user = await getCurrentUser(controller.signal);
        if (user.role !== initialRole) {
          window.location.replace(DEFAULT_DASHBOARD_ROUTE[user.role]);
          return;
        }
        setSession(user);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (!(error instanceof AuthError) || error.status === 401) {
          window.location.replace("/login");
        }
      }
    };

    void verifySession();
    const heartbeat = window.setInterval(verifySession, 5 * 60_000);
    return () => {
      controller.abort();
      window.clearInterval(heartbeat);
    };
  }, [initialRole]);

  const activeSection = initialSection;
  const nav = NAVIGATION[role];

  const titles: Record<Section, [string, string]> = {
    overview: ["Обзор бизнеса", "Продажи и возвраты по данным 1С"],
    products: ["Товары и продажи", "Документы и товарные строки из 1С"],
    stock: ["Склад и остатки", "Фактические остатки по складам"],
    team: ["Продавцы", "Продажи с привязкой к сотрудникам"],
    procurement: [
      "Закуп / Перемещение",
      "Заявки на основании фактических остатков",
    ],
    online: ["Онлайн", "Будущая аналитика цифровых каналов"],
  };

  const changeSection = (nextSection: Section) => {
    setMenuOpen(false);
    router.push(dashboardRoute(role, nextSection));
  };

  const logout = async () => {
    try {
      await endSession();
    } finally {
      window.location.replace("/login");
    }
  };

  if (!session) {
    return (
      <div className="auth-loading">
        <div className="auth-spinner" />
        <span>Загружаем аналитику…</span>
      </div>
    );
  }

  return (
    <div className="app-shell" data-role={role}>
      {menuOpen && (
        <button
          className="drawer-backdrop"
          aria-label="Закрыть меню"
          onClick={() => setMenuOpen(false)}
        />
      )}

      <aside className={menuOpen ? "sidebar open" : "sidebar"}>
        <div className="brand">
          <div className="product-mark">
            <ChartNoAxesCombined size={22} strokeWidth={2} />
          </div>
          <div>
            <strong>Аналитика</strong>
            <span>данные из 1С</span>
          </div>
          <button
            className="drawer-close"
            aria-label="Закрыть меню"
            onClick={() => setMenuOpen(false)}
          >
            <X size={20} />
          </button>
        </div>

        <nav>
          {nav.map((item) => (
            <button
              key={item.id}
              className={activeSection === item.id ? "active" : ""}
              onClick={() => changeSection(item.id as Section)}
            >
              <Icon name={item.id} />
              <span>{item.label}</span>
              {item.id === "online" && <small>Phase 2</small>}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sync">
            <i />
            <div>
              <b>Источник подключён</b>
              <span>1С OData</span>
            </div>
          </div>
          <button className="sidebar-logout" onClick={logout}>
            <LogOut size={17} />
            <span>Выйти из аккаунта</span>
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <button
            className="menu-toggle"
            aria-label="Открыть меню"
            onClick={() => setMenuOpen(true)}
          >
            <Menu size={21} />
          </button>
          <div className="topbar-spacer" />
          <span className="role-pill">
            {role === "owner" ? "Владелец" : "Менеджер"}
          </span>
          <div className="user">
            <div className="avatar small">{session.name[0]}</div>
            <div className="user-copy">
              <strong>{session.name}</strong>
              <span>{session.email}</span>
            </div>
          </div>
          <button className="logout-button" onClick={logout} aria-label="Выйти">
            <LogOut size={18} />
            <span>Выйти</span>
          </button>
        </header>

        <div className="content">
          <div className="role-workspace">
            <div className="title-row">
              <div>
                <p className="eyebrow">1С РОЗНИЦА · РЕАЛЬНЫЕ ДАННЫЕ</p>
                <h1>{titles[activeSection][0]}</h1>
                <span>{titles[activeSection][1]}</span>
              </div>
              {role === "owner" && (
                <div className="owner-period-controls">
                  <div className="period">
                    {([7, 30, 90] as Period[]).map((value) => (
                      <button
                        key={value}
                        onClick={() => useOwnerPreset(value)}
                        className={!ownerDateRange && period === value ? "active" : ""}
                      >
                        {value} дней
                      </button>
                    ))}
                  </div>

                  <div className="owner-date-range">
                    <label>
                      <span>От</span>
                      <input
                        type="date"
                        value={dateFrom}
                        onChange={(event) => setDateFrom(event.target.value)}
                      />
                    </label>
                    <label>
                      <span>До</span>
                      <input
                        type="date"
                        value={dateTo}
                        min={dateFrom || undefined}
                        onChange={(event) => setDateTo(event.target.value)}
                      />
                    </label>
                    <button
                      className={ownerDateRange ? "active" : ""}
                      disabled={!canApplyOwnerRange}
                      onClick={applyOwnerRange}
                    >
                      Применить
                    </button>
                  </div>
                </div>
              )}
            </div>

            {role === "owner" && (
              <OnecOverview period={period} dateRange={ownerDateRange} />
            )}
            {role === "manager" && activeSection === "products" && <OnecSales />}
            {role === "manager" && activeSection === "stock" && <OnecStock />}
            {role === "manager" && activeSection === "team" && <OnecTeam />}
            {role === "manager" &&
              activeSection === "procurement" &&
              <OnecProcurement />}
            {role === "manager" && activeSection === "online" && <Online />}
          </div>
        </div>

        {role === "manager" && (
          <nav className="mobile-nav">
            {nav.map((item) => (
              <button
                key={item.id}
                className={activeSection === item.id ? "active" : ""}
                onClick={() => changeSection(item.id as Section)}
              >
                <Icon name={item.id} />
                <span>
                  {item.id === "products"
                    ? "Товары"
                    : item.id === "procurement"
                      ? "Закуп"
                      : item.label.split(" ")[0]}
                </span>
              </button>
            ))}
          </nav>
        )}
      </main>
    </div>
  );
}
