// RecurrenceEditor — build/parse a limited RRULE subset
// Supported: none, daily, weekly (by day), monthly + optional UNTIL or COUNT
import React, { useState, useEffect } from "react";
import { Label } from "./ui/label";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { cn } from "../lib/utils";
// Freq/Weekday/DAYS/DAY_LABELS/RRuleState/buildRRule/parseRRule moved verbatim to
// web/src/lib/rrule.ts (item-view-mode plan Decision 4/HC3, so describeRecurrence can reuse
// the same parser without a second, drifting implementation). No behavior change here.
import { DAYS, DAY_LABELS, buildRRule, parseRRule, type RRuleState, type Weekday, type Freq } from "../lib/rrule";

interface Props {
  rrule: string | null;
  onChange: (rrule: string | null) => void;
}

export function RecurrenceEditor({ rrule, onChange }: Props) {
  const [state, setState] = useState<RRuleState>(() => parseRRule(rrule));

  useEffect(() => {
    onChange(buildRRule(state));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const set = (patch: Partial<RRuleState>) => {
    setState((prev) => ({ ...prev, ...patch }));
  };

  const toggleDay = (day: Weekday) => {
    set({
      byday: state.byday.includes(day)
        ? state.byday.filter((d) => d !== day)
        : [...state.byday, day],
    });
  };

  return (
    <div>
      <Label className="mb-1.5 block">Repeat</Label>

      {/* Freq select — non-form-critical, no empty->null mapping (plan §5.4/M5): safe to use
          shadcn Select here. */}
      <Select value={state.freq} onValueChange={(value) => set({ freq: value as Freq })}>
        <SelectTrigger className="mb-2 w-full max-w-[220px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Does not repeat</SelectItem>
          <SelectItem value="daily">Daily</SelectItem>
          <SelectItem value="weekly">Weekly</SelectItem>
          <SelectItem value="monthly">Monthly</SelectItem>
        </SelectContent>
      </Select>

      {state.freq !== "none" && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-sm">Every</span>
            <Input
              type="number"
              min={1}
              value={state.interval}
              onChange={(e) => set({ interval: Number(e.target.value) })}
              className="w-14"
            />
            <span className="text-sm">
              {state.freq === "daily" ? "day(s)" : state.freq === "weekly" ? "week(s)" : "month(s)"}
            </span>
          </div>

          {state.freq === "weekly" && (
            <div className="flex flex-wrap gap-1">
              {DAYS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDay(d)}
                  className={cn(
                    "rounded border px-2 py-1 text-xs",
                    state.byday.includes(d)
                      ? "border-primary bg-accent"
                      : "border-input bg-background"
                  )}
                >
                  {DAY_LABELS[d]}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2">
            {/* End-condition select — non-form-critical (plan §5.4/M5). */}
            <Select
              value={state.endType}
              onValueChange={(value) => set({ endType: value as RRuleState["endType"] })}
            >
              <SelectTrigger className="w-full max-w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="never">No end date</SelectItem>
                <SelectItem value="until">End on date</SelectItem>
                <SelectItem value="count">End after</SelectItem>
              </SelectContent>
            </Select>

            {state.endType === "until" && (
              <Input
                type="date"
                value={state.until}
                onChange={(e) => set({ until: e.target.value })}
                className="w-40"
              />
            )}

            {state.endType === "count" && (
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  min={1}
                  value={state.count}
                  onChange={(e) => set({ count: Number(e.target.value) })}
                  className="w-16"
                />
                <span className="text-sm">occurrences</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
