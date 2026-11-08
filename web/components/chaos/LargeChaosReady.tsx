"use client";
import { useEffect } from "react";
/** This read-only view has no startup animation; release the shared layout's intro lock. */
export function LargeChaosReady() {
  useEffect(() => {
    delete document.documentElement.dataset.resqIntro;
    delete document.documentElement.dataset.resqLand;
  }, []);
  return null;
}
