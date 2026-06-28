"use client";

import Image from "next/image";
import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { submitCheckin, type ActionState } from "@/app/actions";
import { CHECKIN_STATUSES, LIMITS, type CheckinStatus } from "@/lib/constants";
import { Label, TextInput, TextArea, FieldError, Honeypot } from "@/components/Field";
import LocationPicker from "@/components/LocationPicker";
import PhotoInput from "@/components/PhotoInput";
import SubmitButton from "@/components/SubmitButton";

const initial: ActionState = { ok: false };

type FrCandidate = {
  person_name?: string | null;
  image_url?: string | null;
  last_seen_location?: string | null;
  score?: number;
  band?: string;
  source?: string;
};

function pct(s?: number) {
  return Math.round((s || 0) * 100);
}

export default function CheckinForm({
  initialStatus,
}: {
  initialStatus?: CheckinStatus;
}) {
  const [state, action] = useActionState(submitCheckin, initial);
  const [status, setStatus] = useState<CheckinStatus>(initialStatus ?? "SAFE");
  const isMissing = status === "LOOKING_FOR_SOMEONE";
  const t = useTranslations("forms");
  const tc = useTranslations("forms.checkin");
  const tCommon = useTranslations("common");
  const tD = useTranslations("domain");

  // Anti-duplicado por rostro (asistivo): al elegir la foto de una persona
  // desaparecida, comparamos con las ya registradas y avisamos. Nunca bloquea.
  const tFr = useTranslations("forms.fr");
  const [frChecking, setFrChecking] = useState(false);
  const [frCands, setFrCands] = useState<FrCandidate[] | null>(null);
  const [frAnswer, setFrAnswer] = useState<null | "same" | "other">(null);
  const [hasPhoto, setHasPhoto] = useState(false);
  const [frConsent, setFrConsent] = useState(false);

  async function onPhoto(dataUrl: string | null) {
    setHasPhoto(Boolean(dataUrl));
    if (!dataUrl) setFrConsent(false);
    setFrCands(null);
    setFrAnswer(null);
    if (!dataUrl || !isMissing) return;
    setFrChecking(true);
    try {
      const r = await fetch("/api/fr/check-duplicate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ photo: dataUrl }),
      });
      const d = await r.json();
      if (d?.possible_duplicate && Array.isArray(d.candidates) && d.candidates.length) {
        setFrCands(d.candidates.slice(0, 4));
      }
    } catch {
      /* asistivo: si falla, el registro continúa normal */
    } finally {
      setFrChecking(false);
    }
  }

  return (
    <form action={action} className="space-y-5">
      <Honeypot />

      {state.error && (
        <p className="rounded-xl bg-red-50 px-4 py-3 font-medium text-red-700" role="alert">
          {state.error}
        </p>
      )}

      <div>
        <Label htmlFor="name" required>
          {isMissing ? tc("missingName") : tc("yourName")}
        </Label>
        <TextInput
          id="name"
          name="name"
          required
          maxLength={LIMITS.name}
          autoComplete="name"
          enterKeyHint="next"
          placeholder={isMissing ? tc("missingNamePlaceholder") : tc("yourNamePlaceholder")}
        />
        <FieldError message={state.fieldErrors?.name} />
      </div>

      <fieldset>
        <legend className="mb-2 block font-semibold text-slate-800">
          {tc("situationLegend")} <span className="text-red-600">*</span>
        </legend>
        <div className="grid gap-2">
          {(Object.keys(CHECKIN_STATUSES) as Array<keyof typeof CHECKIN_STATUSES>).map(
            (key) => {
              const s = CHECKIN_STATUSES[key];
              return (
                <label
                  key={key}
                  className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-300 bg-white px-4 py-3 font-semibold has-[:checked]:border-[#2563a8] has-[:checked]:bg-[#eef3fa]"
                >
                  <input
                    type="radio"
                    name="status"
                    value={key}
                    checked={status === key}
                    onChange={() => setStatus(key)}
                    className="h-5 w-5 accent-[#2563a8]"
                  />
                  <span aria-hidden className="text-xl">{s.emoji}</span>
                  <span style={{ color: s.tintText }}>{tD("checkinStatus." + key)}</span>
                </label>
              );
            }
          )}
        </div>
        <FieldError message={state.fieldErrors?.status} />
      </fieldset>

      <div>
        <Label htmlFor="place_name">
          {tc("placeLabel")}{" "}
          <span className="font-normal text-slate-500">{tCommon("optional")}</span>
        </Label>
        <TextInput
          id="place_name"
          name="place_name"
          maxLength={LIMITS.place_name}
          placeholder={
            isMissing ? tc("missingPlacePlaceholder") : tc("placePlaceholder")
          }
        />
      </div>

      <div>
        <Label htmlFor="city">{tCommon("city")}</Label>
        <TextInput
          id="city"
          name="city"
          maxLength={LIMITS.city}
          placeholder={tc("cityPlaceholder")}
        />
      </div>

      <div>
        <Label htmlFor="message" hint={tCommon("optional")}>
          {tCommon("message")}
        </Label>
        <TextArea
          id="message"
          name="message"
          maxLength={LIMITS.message}
          placeholder={
            isMissing
              ? tc("missingMessagePlaceholder")
              : tc("messagePlaceholder")
          }
        />
      </div>

      <div>
        <Label htmlFor="phone" hint={t("privateNotShown")}>
          {isMissing ? tc("missingContactLabel") : tc("phoneLabel")}
        </Label>
        <TextInput
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          maxLength={LIMITS.phone}
          autoComplete="tel"
          placeholder={tc("phonePlaceholder")}
        />
        <p className="mt-1 text-sm text-slate-500">{tc("phoneNote")}</p>
      </div>

      <div>
        <PhotoInput
          label={isMissing ? tc("missingPhotoLabel") : tc("photoLabel")}
          onPhoto={isMissing ? onPhoto : (dataUrl) => { setHasPhoto(Boolean(dataUrl)); if (!dataUrl) setFrConsent(false); }}
        />

        {/* Consent checkbox: only when the user attached a photo of themselves
            (not for LOOKING_FOR_SOMEONE, where the photo belongs to a third party). */}
        {hasPhoto && !isMissing && (
          <div className="mt-3 rounded-xl border border-line bg-[#f5f8fc] p-3">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                name="fr_consent"
                value="1"
                checked={frConsent}
                onChange={(e) => setFrConsent(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-action"
              />
              <span className="text-sm font-medium text-ink">
                {tFr("consentLabel")}
              </span>
            </label>
            <p className="mt-1 pl-7 text-xs text-[#5b6b7b]">{tFr("consentNote")}</p>
          </div>
        )}

        {frChecking && (
          <p className="mt-2 text-sm text-[#5b6b7b]">{tFr("checking")}</p>
        )}

        {frCands && frAnswer !== "other" && (
          <div className="mt-3 rounded-xl border border-[#e2603a] bg-[#fdf0e9] p-4">
            <p className="font-semibold text-[#c0512c]">{tFr("maybeRegistered")}</p>
            <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {frCands.map((c, i) => (
                <li key={i} className="rounded-lg border border-[#f0c9bb] bg-white p-2">
                  {c.image_url ? (
                    <Image
                      src={c.image_url}
                      alt=""
                      width={120}
                      height={120}
                      className="h-20 w-full rounded-md object-cover"
                    />
                  ) : (
                    <div className="h-20 w-full rounded-md bg-slate-100" />
                  )}
                  <p className="mt-1 truncate text-xs font-medium text-[#14212e]" title={c.person_name ?? ""}>
                    {c.person_name || "—"}
                  </p>
                  <p className="text-[11px] text-[#5b6b7b]">
                    {pct(c.score)}% · {c.source || ""}
                  </p>
                </li>
              ))}
            </ul>

            {frAnswer === "same" ? (
              <p className="mt-3 text-sm text-[#c0512c]">{tFr("sameNote")}</p>
            ) : (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-[#14212e]">{tFr("question")}</span>
                <button
                  type="button"
                  onClick={() => setFrAnswer("same")}
                  className="rounded-lg border border-[#e2603a] px-3 py-1.5 text-sm font-semibold text-[#c0512c] active:scale-[0.99]"
                >
                  {tFr("yes")}
                </button>
                <button
                  type="button"
                  onClick={() => setFrAnswer("other")}
                  className="rounded-lg bg-[#2563a8] px-3 py-1.5 text-sm font-semibold text-white active:scale-[0.99]"
                >
                  {tFr("no")}
                </button>
              </div>
            )}
            <p className="mt-2 text-[11px] text-[#8190a0]">{tFr("assistiveNote")}</p>
          </div>
        )}
      </div>

      <div>
        <Label htmlFor="location" required={status !== "SAFE"}>
          {isMissing ? tc("missingLocationLabel") : tc("locationLabel")}
        </Label>
        <LocationPicker required={status !== "SAFE"} />
        <FieldError message={state.fieldErrors?.location} />
      </div>

      {isMissing ? (
        <SubmitButton tone="action" pendingLabel={tc("saving")}>
          {tc("submitMissing")}
        </SubmitButton>
      ) : (
        <SubmitButton tone="safe" pendingLabel={tc("saving")}>
          {tc("submitSafe")}
        </SubmitButton>
      )}
    </form>
  );
}
