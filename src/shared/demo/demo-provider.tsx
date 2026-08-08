"use client";

import { createContext, useContext, useEffect, useMemo, useReducer, useState } from "react";
import { initialDemoState } from "./seed";
import type { DemoAction, DemoState, SpeakerRecord } from "./types";

const STORAGE_KEY = "openboard-demo-state-v3";

const DEMO_COLLECTIONS = ["events", "forms", "speakers", "submissions", "sessions", "tasks", "completions", "communications", "reviews", "resources"] as const;

function isDemoSnapshot(value: unknown): value is DemoState {
  if (!value || typeof value !== "object") return false;
  return DEMO_COLLECTIONS.every((key) => Array.isArray((value as Record<string, unknown>)[key]));
}

function reducer(state: DemoState, action: DemoAction): DemoState {
  switch (action.type) {
    case "RESET": return structuredClone(initialDemoState);
    case "HYDRATE": return action.state;
    case "ADD_FORM": return { ...state, forms: [...state.forms, action.form] };
    case "UPDATE_FORM": return { ...state, forms: state.forms.map((item) => item.id === action.formId ? { ...item, ...action.patch } : item) };
    case "ADD_FIELD": return { ...state, forms: state.forms.map((form) => form.id !== action.formId ? form : { ...form, version: form.version + 1, sections: form.sections.map((section) => section.id === action.sectionId ? { ...section, fields: [...section.fields, action.field] } : section) }) };
    case "UPDATE_FIELD": return { ...state, forms: state.forms.map((form) => form.id !== action.formId ? form : { ...form, version: form.version + 1, sections: form.sections.map((section) => section.id === action.sectionId ? { ...section, fields: section.fields.map((field) => field.id === action.fieldId ? { ...field, ...action.patch } : field) } : section) }) };
    case "DELETE_FIELD": return { ...state, forms: state.forms.map((form) => form.id !== action.formId ? form : { ...form, version: form.version + 1, sections: form.sections.map((section) => section.id === action.sectionId ? { ...section, fields: section.fields.filter((field) => field.id !== action.fieldId || field.locked) } : section) }) };
    case "ADD_SUBMISSION": return { ...state, submissions: [action.submission, ...state.submissions], forms: state.forms.map((form) => form.id === action.submission.formId ? { ...form, submissions: form.submissions + 1 } : form) };
    case "UPDATE_SUBMISSION": return { ...state, submissions: state.submissions.map((item) => item.id === action.submissionId ? { ...item, ...action.patch } : item) };
    case "ADD_REVIEW": return { ...state, reviews: [...state.reviews, action.review], submissions: state.submissions.map((submission) => {
      if (submission.id !== action.review.submissionId) return submission;
      const scores = [...state.reviews.filter((review) => review.submissionId === submission.id).map((review) => review.score), action.review.score];
      return { ...submission, score: scores.reduce((sum, score) => sum + score, 0) / scores.length, reviewCount: scores.length };
    }) };
    case "ADD_SPEAKER": return { ...state, speakers: [...state.speakers, action.speaker] };
    case "UPDATE_SPEAKER": return { ...state, speakers: state.speakers.map((item) => item.id === action.speakerId ? { ...item, ...action.patch } : item) };
    case "ADD_TASK": return { ...state, tasks: [...state.tasks, action.task] };
    case "UPDATE_TASK": return { ...state, tasks: state.tasks.map((item) => item.id === action.taskId ? { ...item, ...action.patch } : item) };
    case "COMPLETE_TASK": {
      const alreadyCompleted = state.completions.some((item) => item.taskId === action.completion.taskId && item.speakerId === action.completion.speakerId);
      return {
        ...state,
        completions: [...state.completions.filter((item) => !(item.taskId === action.completion.taskId && item.speakerId === action.completion.speakerId)), action.completion],
        tasks: alreadyCompleted ? state.tasks : state.tasks.map((task) => task.id === action.completion.taskId ? { ...task, completed: Math.min(task.assigned, task.completed + 1) } : task),
      };
    }
    case "ADD_SESSION": return { ...state, sessions: [...state.sessions, action.session] };
    case "UPDATE_SESSION": return { ...state, sessions: state.sessions.map((item) => item.id === action.sessionId ? { ...item, ...action.patch } : item) };
    case "ADD_COMMUNICATION": return { ...state, communications: [action.communication, ...state.communications] };
    case "UPDATE_EVENT": return { ...state, events: state.events.map((item) => item.id === action.eventId ? { ...item, ...action.patch } : item) };
    case "ADD_RESOURCE": return { ...state, resources: [...state.resources, action.resource] };
    case "UPDATE_RESOURCE": return { ...state, resources: state.resources.map((item) => item.id === action.resourceId ? { ...item, ...action.patch } : item) };
    default: return state;
  }
}

type DemoContextValue = { state: DemoState; dispatch: React.Dispatch<DemoAction>; hydrated: boolean; reset: () => void };
const DemoContext = createContext<DemoContextValue | null>(null);

export function DemoProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialDemoState);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed: unknown = JSON.parse(saved);
        if (!isDemoSnapshot(parsed)) throw new Error("invalid snapshot");
        dispatch({ type: "HYDRATE", state: parsed });
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [hydrated, state]);

  const value = useMemo(() => ({ state, dispatch, hydrated, reset: () => { window.localStorage.removeItem(STORAGE_KEY); dispatch({ type: "RESET" }); } }), [state, hydrated]);
  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemo() {
  const value = useContext(DemoContext);
  if (!value) throw new Error("useDemo must be inside DemoProvider");
  return value;
}

export function speakerName(speaker: SpeakerRecord | undefined) {
  return speaker ? `${speaker.firstName} ${speaker.lastName}` : "Unknown speaker";
}
