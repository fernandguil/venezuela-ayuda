"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { LIMITS } from "@/lib/constants";
import { cedulaPreview, type CedulaPrefix } from "@/lib/cedula";
import { Label, TextInput, FieldError } from "@/components/Field";

function extractDigits(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 9);
}

function detectPrefixFromPaste(raw: string): CedulaPrefix | null {
  const t = raw.trim().toUpperCase();
  if (t.startsWith("E")) return "E";
  if (t.startsWith("V")) return "V";
  return null;
}

export default function CedulaField({ error }: { error?: string }) {
  const t = useTranslations("forms.checkin");
  const [prefix, setPrefix] = useState<CedulaPrefix>("V");
  const [number, setNumber] = useState("");

  const digits = useMemo(() => extractDigits(number), [number]);

  const preview = useMemo(() => cedulaPreview(prefix, digits), [prefix, digits]);

  function onNumberChange(value: string) {
    const detected = detectPrefixFromPaste(value);
    if (detected) setPrefix(detected);
    setNumber(extractDigits(value));
  }

  return (
    <div>
      <Label htmlFor="cedula_number" hint={t("cedulaOptionalHint")}>
        {t("cedulaLabel")}
      </Label>

      <input type="hidden" name="cedula_prefix" value={prefix} />

      <div className="flex gap-2">
        <div className="flex shrink-0 rounded-xl border border-slate-300 bg-white p-1">
          {(["V", "E"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPrefix(p)}
              className={`min-w-[3rem] rounded-lg px-3 py-2 text-sm font-bold transition ${
                prefix === p
                  ? "bg-[#2563a8] text-white"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
              aria-pressed={prefix === p}
            >
              {p}
            </button>
          ))}
        </div>
        <TextInput
          id="cedula_number"
          name="cedula_number"
          inputMode="numeric"
          autoComplete="off"
          maxLength={LIMITS.cedula}
          placeholder={t("cedulaPlaceholder")}
          value={number}
          onChange={(e) => onNumberChange(e.target.value)}
          className="flex-1"
        />
      </div>

      {preview && (
        <p className="mt-1.5 text-sm font-medium text-[#2563a8]">
          {prefix === "V" ? t("cedulaPreviewV", { value: preview }) : t("cedulaPreviewE", { value: preview })}
        </p>
      )}

      <p className="mt-1 text-sm text-slate-500">{t("cedulaNaturalNote")}</p>
      <p className="mt-1 text-sm text-slate-500">{t("cedulaPrivacyNote")}</p>
      <FieldError message={error} />
    </div>
  );
}
