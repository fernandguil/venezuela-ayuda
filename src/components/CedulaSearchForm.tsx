"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { searchCheckinByCedula, type CedulaSearchState } from "@/app/actions";
import CedulaField from "@/components/CedulaField";
import PersonResultCard from "@/components/PersonResultCard";
import { mergePeople } from "@/lib/people";
import { Honeypot } from "@/components/Field";

const initial: CedulaSearchState = { ok: false };

export default function CedulaSearchForm() {
  const [state, action, pending] = useActionState(searchCheckinByCedula, initial);
  const t = useTranslations("search.cedula");

  const people = state.result ? mergePeople([state.result], [], []) : [];

  return (
    <section className="mt-8 rounded-2xl border border-[#e6ecf2] bg-white p-4">
      <h2 className="text-base font-semibold text-[#14212e]">{t("heading")}</h2>
      <p className="mt-1 text-sm text-[#5b6b7b]">{t("intro")}</p>

      <form action={action} className="mt-4 space-y-3">
        <Honeypot />
        <CedulaField error={state.fieldErrors?.cedula} />

        {state.error && (
          <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700" role="alert">
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="min-h-[48px] w-full rounded-[15px] px-5 py-3 text-base font-semibold text-white disabled:opacity-60"
          style={{ backgroundColor: "#14212e" }}
        >
          {pending ? t("searching") : t("searchButton")}
        </button>
      </form>

      {state.searched && !state.result && !state.error && !state.fieldErrors?.cedula && (
        <p className="mt-4 text-sm text-[#5b6b7b]">{t("none")}</p>
      )}

      {people.length > 0 && (
        <div className="mt-4">
          <PersonResultCard p={people[0]} />
        </div>
      )}
    </section>
  );
}
