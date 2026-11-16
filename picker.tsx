import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { readPreference, savePreference, stringList } from "./preferences";
import { filterOptions, type ChoiceOption } from "./selection";
export function SearchPicker({
  label,
  placeholder,
  options,
  value,
  onChange,
  disabled = false,
  visibilityKey,
  action,
}: {
  label: string;
  placeholder: string;
  options: ChoiceOption[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  visibilityKey?: string;
  action?: { label: string; icon?: ReactNode; disabled?: boolean; onSelect: () => void };
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const [hidden, setHidden] = useState(() =>
    visibilityKey ? readPreference(visibilityKey, [], stringList) : [],
  );
  const groups = [...new Set(options.map((o) => o.group))];
  const toggleGroup = (group: string) => {
    setHidden((old) => {
      const next = old.includes(group)
        ? old.filter((g) => g !== group)
        : [...old, group];
      if (visibilityKey) savePreference(visibilityKey, next);
      return next;
    });
    setActive(0);
  };
  const filtered = filterOptions(
    options.filter((o) => !hidden.includes(o.group)),
    search,
  );
  const selected = options.find((o) => o.id === value);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  useEffect(() => {
    document
      .getElementById(id + "-" + active)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [active, id]);
  const choose = (key: string) => {
    onChange(key);
    setOpen(false);
    root.current?.querySelector<HTMLButtonElement>("button")?.focus();
  };
  return (
    <div
      className="gw-picker"
      ref={root}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        type="button"
        className="gw-picker-trigger"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        title={selected?.detail}
        onClick={() => {
          setOpen(!open);
          setSearch("");
          setActive(0);
        }}
      >
        <span className="gw-picker-label">{label}</span>
        <span className="gw-picker-value">
          {selected?.label || placeholder}
        </span>
        <span>⌄</span>
      </button>
      {open && (
        <div className={`gw-picker-popup${action ? " gw-picker-with-action" : ""}`}>
          <input
            autoFocus
            role="combobox"
            aria-label={`Filter ${label.toLowerCase()}`}
            aria-controls={id}
            aria-expanded="true"
            aria-autocomplete="list"
            aria-activedescendant={
              filtered[active] ? `${id}-${active}` : undefined
            }
            placeholder="Type to filter…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setOpen(false);
                root.current
                  ?.querySelector<HTMLButtonElement>("button")
                  ?.focus();
              } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setActive((n) =>
                  Math.max(
                    0,
                    Math.min(
                      filtered.length - 1,
                      n + (e.key === "ArrowDown" ? 1 : -1),
                    ),
                  ),
                );
              } else if (e.key === "Enter" && filtered[active]) {
                e.preventDefault();
                choose(filtered[active]!.id);
              }
            }}
          />
          {visibilityKey && groups.length > 0 && (
            <div
              className="gw-group-toggles"
              role="group"
              aria-label="Visible groups"
            >
              {groups.map((group) => (
                <button
                  type="button"
                  key={group}
                  aria-pressed={!hidden.includes(group)}
                  onClick={() => toggleGroup(group)}
                >
                  {group}{" "}
                  <small>
                    {options.filter((o) => o.group === group).length}
                  </small>
                </button>
              ))}
            </div>
          )}
          <div
            role="listbox"
            id={id}
            aria-label={`${label} options`}
            className="gw-picker-results"
          >
            {filtered.map((o, i) => (
              <div key={o.id}>
                {(i === 0 || filtered[i - 1]?.group !== o.group) && (
                  <div className="gw-picker-group">
                    <span>{o.group}</span>
                    <span className="gw-muted">
                      {filtered.filter((item) => item.group === o.group).length}
                    </span>
                  </div>
                )}
                <button
                  type="button"
                  role="option"
                  id={`${id}-${i}`}
                  aria-selected={o.id === value}
                  className={i === active ? "highlighted" : ""}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(o.id)}
                >
                  <span>
                    {o.label}
                    {o.id === value ? " ✓" : ""}
                  </span>
                  <small>{o.detail}</small>
                </button>
              </div>
            ))}
            {!filtered.length && <p className="gw-empty">No matches.</p>}
          </div>
          {action && <div className="gw-picker-actions"><button
            type="button"
            className="gw-action-review"
            disabled={disabled || action.disabled}
            onClick={() => {setOpen(false);action.onSelect();}}
            onKeyDown={e => {if(e.key==='Escape'){e.preventDefault();setOpen(false);root.current?.querySelector<HTMLButtonElement>('.gw-picker-trigger')?.focus();}}}
          >{action.icon}{action.label}</button></div>}
        </div>
      )}
    </div>
  );
}
