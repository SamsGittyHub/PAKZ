"use client";
import { useEffect } from "react";
import { bag } from "./bag-store";

export function ClearBag() {
  useEffect(() => { bag.clear(); }, []);
  return null;
}
