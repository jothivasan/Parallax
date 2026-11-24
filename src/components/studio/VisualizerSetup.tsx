import React, { useId, useRef, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import {
  autoView,
  interpretInstruction,
  readConfig,
  ruleFor,
  structures,
  techniques,
  techniqueRoles,
  type VisualizerConfig,
  type ViewRule,
} from "../../core/visualization/config";

export function VisualizerSetup({
  value,
  onChange,
  onOpen,
  names,
  detected,
}: {
  onOpen: () => void;
  detected: string[];
  value: VisualizerConfig;
  onChange: (value: VisualizerConfig) => void;
  names: string[];
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [draft, setDraft] = useState(value),
    [instruction, setInstruction] = useState(""),
    [message, setMessage] = useState("");
  const edit = (idx: number, patch: Partial<ViewRule>) =>
    setDraft((prev) => ({
      ...prev,
      rules: prev.rules.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    }));
  return (
    <>
      <button
        type="button"
        className="scene-configure"
        onClick={() => {
          onOpen();
          setDraft(value);
          setInstruction("");
          setMessage("");
          dialog.current?.showModal();
        }}
      >
        <SlidersHorizontal size={14} />
        Configure visualizer{" "}
        <small>
          {value.technique !== "Auto"
            ? value.technique
            : value.rules.length
              ? "Custom"
              : "Auto"}
        </small>
      </button>
      <dialog ref={dialog} className="scene-dialog" aria-labelledby={id}>
        <h2 id={id}>Configure visualizer</h2>
        <p>
          Studio follows your trace automatically. Choose a different view for
          any variable.
        </p>
        {detected.length > 0 && (
          <p>
            <strong>Detected at this step</strong> · {detected.join(", ")}
          </p>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const next = interpretInstruction(instruction, names, draft);
            if (next) setDraft(next);
            setMessage(
              next
                ? "Review the choices below, then apply."
                : "Choose the variable and its view below.",
            );
          }}
        >
          <label>
            Describe a view
            <input
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="Two pointers on s[i] and t[j]"
            />
          </label>
          <button type="submit" disabled={!instruction.trim()}>
            Interpret instruction
          </button>
        </form>
        {message && <p role="status">{message}</p>}
        <label>
          Algorithm
          <select
            value={draft.technique}
            onChange={(e) =>
              setDraft({
                ...draft,
                technique: e.target.value as VisualizerConfig["technique"],
              })
            }
          >
            {techniques.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <datalist id={id + "-names"}>
          {names.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        {techniqueRoles[draft.technique]?.map((role) => (
          <label key={role}>
            {role} variable
            <input
              list={id + "-names"}
              value={draft.roles?.[role] ?? ""}
              placeholder="Auto"
              onChange={(e) =>
                setDraft({
                  ...draft,
                  roles: { ...draft.roles, [role]: e.target.value },
                })
              }
            />
          </label>
        ))}
        {draft.rules.map((r, i) => (
          <fieldset key={i}>
            <legend>Variable view</legend>
            <label>
              Variable
              <input
                list={id + "-names"}
                value={r.variable}
                onChange={(e) => edit(i, { variable: e.target.value })}
              />
            </label>
            <label>
              Draw as
              <select
                value={r.structure}
                onChange={(e) =>
                  edit(i, {
                    structure: e.target.value as ViewRule["structure"],
                  })
                }
              >
                {structures.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label>
              Index variables
              <input
                value={r.pointers}
                onChange={(e) => edit(i, { pointers: e.target.value })}
                placeholder="i, j"
              />
            </label>
            {draft.technique === "Sliding window" && (
              <label>
                <input
                  type="checkbox"
                  checked={r.exclusive}
                  onChange={(e) => edit(i, { exclusive: e.target.checked })}
                />{" "}
                Exclusive right boundary
              </label>
            )}
            {["Graph", "Tree", "Trie", "Linked list"].includes(r.structure) && (
              <label>
                Link fields
                <input
                  value={r.links}
                  onChange={(e) => edit(i, { links: e.target.value })}
                  placeholder="left, right"
                />
              </label>
            )}
            <button
              type="button"
              onClick={() =>
                setDraft({
                  ...draft,
                  rules: draft.rules.filter((_, idx) => idx !== i),
                })
              }
            >
              Remove variable choice
            </button>
          </fieldset>
        ))}
        <button
          type="button"
          onClick={() =>
            setDraft({ ...draft, rules: [...draft.rules, ruleFor("")] })
          }
        >
          Add variable view
        </button>
        <footer>
          <button
            type="button"
            onClick={() => {
              onChange(autoView);
              dialog.current?.close();
            }}
          >
            Reset all to Auto
          </button>
          <button type="button" onClick={() => dialog.current?.close()}>
            Cancel
          </button>
          <button
            type="button"
            className="scene-apply"
            onClick={() => {
              onChange(readConfig(draft));
              dialog.current?.close();
            }}
          >
            Apply
          </button>
        </footer>
      </dialog>
    </>
  );
}
