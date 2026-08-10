"use client";

import { FormEvent, useEffect, useState } from "react";
import { ChartNoAxesCombined, Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";

type Role="owner"|"manager";

const accounts=[
  {email:"owner@analytics.kz",password:"owner123",role:"owner" as Role,name:"Александр"},
  {email:"manager@analytics.kz",password:"manager123",role:"manager" as Role,name:"Менеджер"},
];

export function Login(){
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [showPassword,setShowPassword]=useState(false);
  const [error,setError]=useState("");

  useEffect(()=>{
    const stored=window.localStorage.getItem("analytics-session");
    if(!stored)return;
    try{
      const session=JSON.parse(stored) as {role:Role};
      window.location.replace(session.role==="owner"?"/owner":"/manager");
    }catch{
      window.localStorage.removeItem("analytics-session");
    }
  },[]);

  const submit=(event:FormEvent)=>{
    event.preventDefault();
    const account=accounts.find(item=>item.email===email.trim().toLowerCase()&&item.password===password);
    if(!account){
      setError("Неверный логин или пароль");
      return;
    }
    window.localStorage.setItem("analytics-session",JSON.stringify({
      role:account.role,
      name:account.name,
      email:account.email,
    }));
    window.location.replace(account.role==="owner"?"/owner":"/manager");
  };

  const fillDemo=(role:Role)=>{
    const account=accounts.find(item=>item.role===role)!;
    setEmail(account.email);
    setPassword(account.password);
    setError("");
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
        <button className="login-submit" type="submit">Войти</button>
        <div className="demo-access"><span>Быстрый демо-вход</span><div><button type="button" onClick={()=>fillDemo("owner")}>Владелец</button><button type="button" onClick={()=>fillDemo("manager")}>Менеджер</button></div></div>
        <p className="login-note">Демо-пароли подставятся автоматически</p>
      </form>
    </section>
  </main>;
}
