"use client";

import { useEffect, useMemo, useState } from "react";
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
  OnecOverview,
  OnecProcurement,
  OnecStock,
  OnecTeam,
} from "./onec-workspaces";

type Role = "owner" | "manager";
type Section =
  | "overview"
  | "products"
  | "stock"
  | "team"
  | "procurement"
  | "online";
type Session = { role: Role; name: string; email: string };
type Period = 7 | 30 | 90;

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

export function Dashboard({ initialRole }: { initialRole: Role }) {
  const role = initialRole;
  const [session, setSession] = useState<Session | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [section, setSection] = useState<Section>(
    initialRole === "owner" ? "overview" : "products",
  );
  const [period, setPeriod] = useState<Period>(30);

  useEffect(() => {
    const stored = window.localStorage.getItem("analytics-session");

    if (!stored) {
      window.location.replace("/login");
      return;
    }

    try {
      const parsed = JSON.parse(stored) as Session;

      if (parsed.role !== initialRole) {
        window.location.replace(
          parsed.role === "owner" ? "/owner" : "/manager",
        );
        return;
      }

      // Сессия хранится вне React и читается только после гидратации клиента.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSession(parsed);
    } catch {
      window.localStorage.removeItem("analytics-session");
      window.location.replace("/login");
    }
  }, [initialRole]);

  const activeSection: Section =
    role === "owner"
      ? "overview"
      : section === "overview"
        ? "products"
        : section;

  const nav = useMemo(
    () =>
      role === "owner"
        ? [{ id: "overview", label: "Обзор" }]
        : [
            { id: "products", label: "Товары и продажи" },
            { id: "stock", label: "Склад и остатки" },
            { id: "team", label: "Продавцы" },
            { id: "procurement", label: "Закуп / Перемещение" },
            { id: "online", label: "Онлайн" },
          ],
    [role],
  );

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
    setSection(nextSection);
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const logout = () => {
    window.localStorage.removeItem("analytics-session");
    window.location.replace("/login");
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
                <div className="period">
                  {([7, 30, 90] as Period[]).map((value) => (
                    <button
                      key={value}
                      onClick={() => setPeriod(value)}
                      className={period === value ? "active" : ""}
                    >
                      {value} дней
                    </button>
                  ))}
                </div>
              )}
            </div>

            {role === "owner" && <OnecOverview period={period} />}
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
