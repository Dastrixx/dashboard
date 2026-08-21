"use client";

import { FormEvent, useEffect, useState } from "react";
import { ChartNoAxesCombined, Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";
import { AuthError, getCurrentUser, login } from "./auth-client";
import { DEFAULT_DASHBOARD_ROUTE } from "./dashboard-routes";

export function Login(){
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [showPassword,setShowPassword]=useState(false);
  const [error,setError]=useState("");
  const [submitting,setSubmitting]=useState(false);

  useEffect(()=>{
    const controller=new AbortController();
    getCurrentUser(controller.signal)
      .then(user=>window.location.replace(DEFAULT_DASHBOARD_ROUTE[user.role]))
      .catch(()=>undefined);
    return()=>controller.abort();
  },[]);

  const submit=async(event:FormEvent)=>{
    event.preventDefault();
    try{
      setSubmitting(true);
      setError("");
      const user=await login(email.trim().toLowerCase(),password);
      window.location.replace(DEFAULT_DASHBOARD_ROUTE[user.role]);
    }catch(loginError){
      setError(
        loginError instanceof AuthError
          ? loginError.message
          : "Не удалось выполнить вход",
      );
    }finally{
      setSubmitting(false);
    }
  };

  return <main className="login-page">
    <section className="login-visual">
      <div className="login-brand"><div className="product-mark large"><ChartNoAxesCombined size={28}/></div><div><strong>Аналитика</strong><span>Управляйте бизнесом на основе данных</span></div></div>
      <div className="login-copy"><span className="login-kicker">ПРОДАЖИ · СКЛАД · КОМАНДА</span><h1>Главные показатели бизнеса — в одном месте</h1><p>Понятная аналитика для собственника и ежедневные рабочие инструменты для менеджеров.</p></div>
      <div className="login-stats"><div><b>+12,8%</b><span>рост выручки</span></div><div><b>178</b><span>SKU под контролем</span></div><div><b>11:42</b><span>последнее обновление</span></div></div>
    </section>
    <section className="login-panel">
      <form className="login-card" onSubmit={submit}>
        <div className="login-mobile-brand"><div className="product-mark"><ChartNoAxesCombined size={22}/></div><strong>Аналитика</strong></div>
        <div><span className="login-kicker">ДОБРО ПОЖАЛОВАТЬ</span><h2>Вход в систему</h2><p>Введите данные своей учётной записи</p></div>
        <label className="login-field"><span>Email</span><div><Mail size={18}/><input type="email" value={email} onChange={event=>setEmail(event.target.value)} placeholder="name@company.kz" autoComplete="username" required/></div></label>
        <label className="login-field"><span>Пароль</span><div><LockKeyhole size={18}/><input type={showPassword?"text":"password"} value={password} onChange={event=>setPassword(event.target.value)} placeholder="Введите пароль" autoComplete="current-password" required/><button type="button" aria-label={showPassword?"Скрыть пароль":"Показать пароль"} onClick={()=>setShowPassword(value=>!value)}>{showPassword?<EyeOff size={18}/>:<Eye size={18}/>}</button></div></label>
        {error&&<div className="login-error" role="alert">{error}</div>}
        <button className="login-submit" type="submit" disabled={submitting}>{submitting?"Проверяем…":"Войти"}</button>
        <p className="login-note">Защищённая серверная сессия</p>
      </form>
    </section>
  </main>;
}
