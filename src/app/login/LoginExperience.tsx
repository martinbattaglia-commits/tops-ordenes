"use client";

import { useEffect, useState } from "react";
import LoginForm from "./LoginForm";

/**
 * LoginExperience — capa VISUAL del acceso corporativo TOPS NEXUS (UI 2026).
 *
 * Orquesta:
 *  - FASE 1 · Splash de marca (anillos + logo corporativo). Se muestra una
 *    sola vez por sesión (sessionStorage) y es salteable con click/tecla.
 *  - FASE 2 · Login de dos paneles (institucional 65% + formulario 35%).
 *
 * NO contiene lógica de autenticación: eso vive en <LoginForm>, intacto.
 */

const SPLASH_DURATION_MS = 3200;
const SPLASH_SEEN_KEY = "tn-splash-seen";

const DAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export default function LoginExperience({
  redirectTo,
  initialError,
}: {
  redirectTo?: string;
  initialError?: string;
}) {
  // Splash: por defecto NO bloquea (SSR/no-JS ven el login directo). El cliente
  // decide si mostrarlo según sessionStorage.
  const [splashActive, setSplashActive] = useState(false);
  const [splashGone, setSplashGone] = useState(false);
  const [appShown, setAppShown] = useState(true);
  const [clock, setClock] = useState<{ t: string; d: string }>({ t: "--:--", d: "—" });

  // Decisión de splash (solo cliente, una vez por sesión). Separada del timer
  // para ser robusta ante el doble-montaje de React StrictMode en dev.
  useEffect(() => {
    let seen = false;
    try {
      seen = sessionStorage.getItem(SPLASH_SEEN_KEY) === "1";
    } catch {
      /* sessionStorage no disponible → tratamos como ya visto */
      seen = true;
    }
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!seen && !reduceMotion) {
      setSplashActive(true);
      setAppShown(false);
      try {
        sessionStorage.setItem(SPLASH_SEEN_KEY, "1");
      } catch {
        /* noop */
      }
    }
  }, []);

  // Auto-dismiss del splash: cualquier render con splashActive=true mantiene un
  // timer vivo (StrictMode re-ejecuta este efecto y deja el último timer activo).
  useEffect(() => {
    if (!splashActive || splashGone) return;
    const id = setTimeout(endSplash, SPLASH_DURATION_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splashActive, splashGone]);

  // Reloj institucional (panel izquierdo)
  useEffect(() => {
    const tick = () => {
      const n = new Date();
      const t =
        String(n.getHours()).padStart(2, "0") + ":" + String(n.getMinutes()).padStart(2, "0");
      const d = `${DAYS[n.getDay()].slice(0, 3)} ${n.getDate()} ${MONTHS[n.getMonth()]} ${n.getFullYear()}`;
      setClock({ t, d });
    };
    tick();
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, []);

  function endSplash() {
    setSplashGone(true);
    setAppShown(true);
    // Quita el splash del flujo tras la transición de salida
    setTimeout(() => setSplashActive(false), 1200);
  }

  return (
    <>
      {/* ============ FASE 1 · SPLASH ============ */}
      {splashActive && (
        <div
          className={`tn-splash${splashGone ? " tn-gone" : ""}`}
          onClick={endSplash}
          role="button"
          tabIndex={0}
          aria-label="Saltar introducción"
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " " || e.key === "Escape") endSplash();
          }}
        >
          <div className="tn-splash-core">
            <div className="tn-rings">
              <span />
              <span />
              <span />
              <i className="tn-tick" />
            </div>
            <div className="tn-splash-glow" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="tn-splash-logo"
              src="/icons/logo-color-transparent.png"
              alt="TOPS NEXUS — Operating System"
            />
          </div>
          <div className="tn-splash-foot">
            <div className="tn-sub">
              Logística <b>TOPS</b> · Verotin S.A.
            </div>
            <div className="tn-loadbar">
              <i />
            </div>
            <div className="tn-loadtxt">Inicializando sistema operativo</div>
          </div>
        </div>
      )}

      {/* ============ FASE 2 · LOGIN ============ */}
      <div className={`tn-app${appShown ? " tn-show" : ""}`}>
        {/* ---------- LEFT 65% · panel institucional ---------- */}
        <section className="tn-left" aria-label="TOPS NEXUS · Panel institucional">
          <div className="tn-photo" />
          <div className="tn-photo-tint" />
          <div className="tn-overlay" />
          <div className="tn-aurora" />
          <div className="tn-grid" />

          <div className="tn-l-top tn-reveal" style={{ animationDelay: ".05s" }}>
            <div className="tn-brand">
              <div className="tn-badge">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icons/logo-isologo-primary.png" alt="Logística TOPS" />
              </div>
              <div className="tn-wm">
                <b>LOGÍSTICA TOPS</b>
                <span>Operating System</span>
              </div>
            </div>
            <div className="tn-l-status">
              <div className="tn-pill">
                <span className="tn-dot" />
                Sistema operativo
              </div>
              <div className="tn-clock">
                <span className="tn-t">{clock.t}</span>
                <span className="tn-d">{clock.d}</span>
              </div>
            </div>
          </div>

          <div className="tn-l-hero tn-reveal" style={{ animationDelay: ".18s" }}>
            <div className="tn-eyebrow">Logistics Operating System · Edición 2026</div>
            <h1>
              TOPS NEXUS.
              <br />
              OPERACIONES 3PL,
              <br />
              <em>SIN IMPROVISACIONES.</em>
            </h1>
            <p>
              Cockpit corporativo para la gestión integral de operaciones logísticas, almacenamiento
              ANMAT, compras, CRM, seguridad, trazabilidad, documental y analítica empresarial.{" "}
              <b>Desde 1985 impulsando la logística de Argentina.</b>
            </p>

            <div className="tn-kpis">
              <div className="tn-kpi">
                <div className="tn-v">40+</div>
                <div className="tn-l">
                  Años de
                  <br />
                  experiencia
                </div>
              </div>
              <div className="tn-kpi">
                <div className="tn-v">15.000</div>
                <div className="tn-l">
                  M²
                  <br />
                  operativos
                </div>
              </div>
              <div className="tn-kpi">
                <div className="tn-v tn-cyan">ANMAT</div>
                <div className="tn-l">
                  Habilitación
                  <br />
                  vigente
                </div>
              </div>
              <div className="tn-kpi">
                <div className="tn-v">24/7</div>
                <div className="tn-l">
                  Monitoreo y
                  <br />
                  operaciones
                </div>
              </div>
            </div>
          </div>

          <div className="tn-l-foot tn-reveal" style={{ animationDelay: ".3s" }}>
            <div className="tn-addr">
              <b>VEROTIN S.A.</b> · <span className="tn-mono">CUIT 30-69010113-1</span>
              <br />
              Agustín Magaldi 1765 · Ciudad Autónoma de Buenos Aires · Argentina
            </div>
            <div className="tn-marks">
              <span>
                <i />
                ANMAT
              </span>
              <span>
                <i style={{ background: "var(--tn-ok)" }} />
                IGJ 1984
              </span>
              <span>
                <i style={{ background: "var(--tn-400)" }} />
                3PL
              </span>
            </div>
          </div>
        </section>

        {/* ---------- RIGHT 35% · acceso ---------- */}
        <section className="tn-right" aria-label="TOPS NEXUS · Acceso corporativo">
          <div className="tn-banner tn-reveal" style={{ animationDelay: ".1s" }}>
            <div className="tn-tex" />
            <div className="tn-world" />
            <div className="tn-mul" />
            <div className="tn-vig" />
            <div className="tn-scan" />
            <div className="tn-b-label">
              <span className="tn-live" />
              Centro de control · Supply chain global
            </div>
            <div className="tn-b-title">
              <div className="tn-t">Torre de operaciones</div>
              <div className="tn-s">Trazabilidad · Inteligencia de negocio · 24/7</div>
            </div>
            <div className="tn-avatar">
              <div className="tn-ring" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="tn-av-img" src="/icons/login/operator.png" alt="Operador en línea" />
              <div className="tn-tag">En línea</div>
            </div>
          </div>

          <div className="tn-form-scroll">
            <LoginForm redirectTo={redirectTo} initialError={initialError} />
          </div>
        </section>
      </div>
    </>
  );
}
