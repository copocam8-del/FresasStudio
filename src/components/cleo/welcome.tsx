"use client";

import { useState } from "react";

/**
 * Bienvenida con el logo: dura menos de 2 segundos, se ve una sola vez por sesión del
 * navegador y se saltea tocando en cualquier lado. Se va sola aunque no cargue el
 * JavaScript (animación CSS) y no aparece con "reducir movimiento".
 *
 * El script es un texto FIJO (no lleva datos del estudio): marca la sesión y, si ya se
 * vio, la oculta antes de pintar.
 */
const ONCE = `try{if(sessionStorage.getItem("cleo-welcome")){document.documentElement.dataset.welcomeSeen="1"}else{sessionStorage.setItem("cleo-welcome","1")}}catch(e){}`;

export function WelcomeSplash({ children }: { children: React.ReactNode }) {
  const [gone, setGone] = useState(false);
  if (gone) return null;
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: ONCE }} />
      <div
        className="cleo-welcome"
        role="presentation"
        onClick={() => setGone(true)}
        onAnimationEnd={(e) => {
          if (e.animationName === "cleo-welcome-out") setGone(true);
        }}
      >
        <div className="cleo-welcome-logo">{children}</div>
        <button type="button" className="cleo-welcome-skip" onClick={() => setGone(true)}>
          Tocá para saltear
        </button>
      </div>
    </>
  );
}
