"use client";

import { createContext, useContext, useEffect, useMemo, useReducer, useState } from "react";
import { initialDemoState } from "./seed";
import type { DemoAction, DemoState } from "./types";

const STORAGE_KEY = "openboard-demo-state-v3";

function reducer(state: DemoState, action: DemoAction): DemoState {
  switch (action.type) {
    case "RESET": return structuredClone(initialDemoState);
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
    case "UPDATE_SPEAKER": return { ...state, speakers: state.speakers.map((item) => item.id === action.speakerId ? { ...item, ...action.patch } : item) };
    case "ADD_TASK": return { ...state, tasks: [...state.tasks, action.task] };
    case "COMPLETE_TASK": return { ...state, completions: [...state.completions.filter((item) => !(item.taskId === action.completion.taskId && item.speakerId === action.completion.speakerId)), action.completion] };
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
        const parsed = JSON.parse(saved) as DemoState;
        for (const form of parsed.forms) dispatch({ type: "UPDATE_FORM", formId: form.id, patch: form });
        for (const submission of parsed.submissions.filter((item) => !initialDemoState.submissions.some((seed) => seed.id === item.id))) dispatch({ type: "ADD_SUBMISSION", submission });
        for (const speaker of parsed.speakers) dispatch({ type: "UPDATE_SPEAKER", speakerId: speaker.id, patch: speaker });
        for (const session of parsed.sessions) dispatch({ type: "UPDATE_SESSION", sessionId: session.id, patch: session });
        for (const completion of parsed.completions.filter((item) => !initialDemoState.completions.some((seed) => seed.taskId === item.taskId && seed.speakerId === item.speakerId))) dispatch({ type: "COMPLETE_TASK", completion });
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

import type { SpeakerRecord } from "./types";
