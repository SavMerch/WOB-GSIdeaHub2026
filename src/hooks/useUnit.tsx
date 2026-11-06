import * as React from "react";
import { Navigate, Outlet, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { unwrap } from "@/lib/api";
import { useAuth } from "./useAuth";

export interface Unit {
  id: string;
  slug: string;
  name: string;
  short_name: string;
  segment: "corporate" | "government";
  sort: number;
  active: boolean;
}

export const SEGMENT_LABEL = { corporate: "Corporate Solutions", government: "Government Solutions" } as const;

/** Units the signed-in person can open (the database filters this list). */
export function useUnits() {
  const { membership } = useAuth();
  return useQuery({
    queryKey: ["units"],
    enabled: membership?.status === "active",
    staleTime: 5 * 60_000,
    queryFn: async () => unwrap(await supabase.from("business_units").select("*").eq("active", true).order("sort")) as Unit[],
  });
}

/** Units the person is assigned to (vs. visible via cross-cutting access). */
export function useMyUnitIds() {
  const { session, membership } = useAuth();
  return useQuery({
    queryKey: ["my-units", session?.user.id],
    enabled: membership?.status === "active",
    queryFn: async () =>
      (unwrap(await supabase.from("unit_memberships").select("unit_id").eq("user_id", session!.user.id)) as { unit_id: string }[])
        .map((r) => r.unit_id),
  });
}

const UnitContext = React.createContext<Unit | null>(null);

export function useOptionalUnit() {
  return React.useContext(UnitContext);
}

export function useUnit(): Unit {
  const u = React.useContext(UnitContext);
  if (!u) throw new Error("useUnit outside a business unit");
  return u;
}

/** True when the person is assigned to the current unit (needed to answer surveys). */
export function useIsUnitMember() {
  const unit = useUnit();
  const { data } = useMyUnitIds();
  return !!data?.includes(unit.id);
}

export const unitPath = (slug: string, sub = "home") => `/u/${slug}/${sub.replace(/^\//, "")}`;

const LAST_UNIT_KEY = "lc:last-unit";
export function rememberUnit(slug: string) {
  try {
    localStorage.setItem(LAST_UNIT_KEY, slug);
  } catch {
    /* storage unavailable */
  }
}
export function lastUnit(): string | null {
  try {
    return localStorage.getItem(LAST_UNIT_KEY);
  } catch {
    return null;
  }
}

/** Route wrapper for /u/:unit/*. Unknown or inaccessible units go back to the picker. */
export function UnitLayout() {
  const { unit: slug } = useParams();
  const { data: units, isLoading } = useUnits();
  const unit = units?.find((u) => u.slug === slug);
  React.useEffect(() => {
    if (unit) rememberUnit(unit.slug);
  }, [unit]);
  if (isLoading) return null;
  if (!unit) return <Navigate to="/units" replace />;
  return (
    <UnitContext.Provider value={unit}>
      <Outlet />
    </UnitContext.Provider>
  );
}
