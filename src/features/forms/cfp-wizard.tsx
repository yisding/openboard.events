"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Clock3, FileText, Mail, Save, ShieldCheck, Sparkles, UserPlus, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useDemo } from "@/shared/demo/demo-provider";
import { Brand } from "@/shared/ui/brand";
import type { DemoAnswers as Answers, DemoAnswerValue as AnswerValue } from "@/shared/demo/types";
import type { FormFieldRecord, SpeakerRecord, SubmissionRecord } from "@/shared/demo/types";

const wizardSteps = ["Welcome", "Account", "Submission", "Participant", "Review"];

function formAvailability(form: { status: string; opensAt: string; closesAt: string }, now: number) {
  if (form.status !== "open") return "closed";
  if (form.opensAt && now < Date.parse(form.opensAt)) return "not_open_yet";
  if (form.closesAt && now > Date.parse(form.closesAt)) return "closed";
  return "open";
}

export function CfpWizard({ eventSlug, formId }: { eventSlug: string; formId: string }) {
  const { state, dispatch } = useDemo();
  const router = useRouter();
  const event = state.events.find((item) => item.slug === eventSlug);
  const form = state.forms.find((item) => (item.id === formId || item.slug === formId) && item.eventId === event?.id);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Answers>({});
  const [email, setEmail] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [verified, setVerified] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [company, setCompany] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [coSpeaker, setCoSpeaker] = useState(false);
  const [coName, setCoName] = useState("");
  const [coEmail, setCoEmail] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [autosaved, setAutosaved] = useState(false);
  const existingSpeaker = useMemo(() => state.speakers.find((speaker) => speaker.email.toLowerCase() === email.toLowerCase()), [state.speakers, email]);

  useEffect(() => {
    if (!form) return;
    const raw = window.localStorage.getItem(`openboard-draft-${form.id}`);
    if (raw) { try { const draft = JSON.parse(raw) as { answers: Answers; email: string; firstName: string; lastName: string; company: string; jobTitle: string }; setAnswers(draft.answers); setEmail(draft.email); setFirstName(draft.firstName); setLastName(draft.lastName); setCompany(draft.company); setJobTitle(draft.jobTitle); } catch { /* ignore invalid local draft */ } }
  }, [form]);

  useEffect(() => {
    if (!form || step < 2) return;
    const handle = window.setTimeout(() => { window.localStorage.setItem(`openboard-draft-${form.id}`, JSON.stringify({ answers, email, firstName, lastName, company, jobTitle })); setAutosaved(true); window.setTimeout(() => setAutosaved(false), 1200); }, 500);
    return () => window.clearTimeout(handle);
  }, [answers, company, email, firstName, form, jobTitle, lastName, step]);

  useEffect(() => {
    if (Object.keys(errors).length === 0) return;
    const frame = window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('.cfp-form-card [aria-invalid="true"]')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [errors]);

  if (!event || !form) return <main className="cfp-error"><Brand dark /><FileText size={36} /><h1>This form isn’t available.</h1><p>Check the link or contact the event organizer.</p></main>;
  const availability = formAvailability(form, Date.now());
  if (availability === "not_open_yet") return <main className="cfp-error"><Brand dark /><Clock3 size={36} /><h1>The call for speakers hasn’t opened yet.</h1><p>This form opens {new Date(form.opensAt).toLocaleString()}. Check back then.</p></main>;
  if (availability === "closed") return <main className="cfp-error"><Brand dark /><Clock3 size={36} /><h1>The call for speakers is closed.</h1><p>This form is not accepting new or updated submissions right now.</p><Link href={`/e/${event.slug}/agenda`}>View the event schedule</Link></main>;
  const currentEvent = event;
  const currentForm = form;
  const participantSections = currentForm.sections.filter((section) => section.id.includes("speaker"));
  const submissionSections = currentForm.sections.filter((section) => !section.id.includes("speaker"));
  const allFields = currentForm.sections.flatMap((section) => section.fields);
  const customParticipantFields = participantSections.flatMap((section) => section.fields).filter((field) => !["first_name", "last_name", "email", "title"].includes(field.key));
  const visibleOf = (fields: FormFieldRecord[]) => fields.filter((field) => !field.visibility || evaluateVisibility(field, allFields, answers));

  function answer(field: FormFieldRecord, value: AnswerValue) { setAnswers((current) => ({ ...current, [field.key]: value })); setErrors((current) => { const next = { ...current }; delete next[field.key]; return next; }); }
  function sendCode() { if (!/^\S+@\S+\.\S+$/.test(email)) { setErrors({ email: "Enter a valid email address." }); return; } setCodeSent(true); setErrors({}); }
  function verifyCode() {
    if (code !== "424242") { setErrors({ code: "That code doesn’t match. Try 424242 in this demo." }); return; }
    setVerified(true); if (existingSpeaker) { setFirstName(existingSpeaker.firstName); setLastName(existingSpeaker.lastName); setCompany(existingSpeaker.company); setJobTitle(existingSpeaker.title); } setStep(2); setErrors({});
  }
  function validateSubmission() {
    const visible = visibleOf(submissionSections.flatMap((section) => section.fields));
    const next: Record<string, string> = {}; for (const field of visible) if (field.required && !isAnswered(answers[field.key])) next[field.key] = "This question is required.";
    setErrors(next); return Object.keys(next).length === 0;
  }
  function validateParticipant() {
    const next: Record<string, string> = {};
    if (!firstName.trim() || !lastName.trim()) next.participant = "Add your first and last name.";
    if (coSpeaker && (!coName.trim() || !/^\S+@\S+\.\S+$/.test(coEmail))) next.participant = "Add your co-speaker’s name and a valid email, or remove the co-speaker.";
    for (const field of visibleOf(customParticipantFields)) if (field.required && !isAnswered(answers[field.key])) next[field.key] = "This question is required.";
    setErrors(next); return Object.keys(next).length === 0;
  }
  function goNext() {
    if (step === 1) { if (!codeSent) sendCode(); else verifyCode(); return; }
    if (step === 2 && !validateSubmission()) return;
    if (step === 3 && !validateParticipant()) return;
    setErrors({}); setStep((value) => Math.min(4, value + 1)); window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function submit() {
    if (!agreed) { setErrors({ agreed: "Confirm the speaker terms before submitting." }); return; }
    // Authoritative gates re-checked at submit time, not only at render.
    if (formAvailability(currentForm, Date.now()) !== "open") { setErrors({ submit: "This call closed while you were editing. Your draft is saved in this browser." }); return; }
    if (currentForm.submissions >= currentForm.submissionLimit) { setErrors({ submit: "This form has reached its submission limit." }); return; }
    const ownSubmissions = existingSpeaker ? state.submissions.filter((item) => item.formId === currentForm.id && item.speakerIds.includes(existingSpeaker.id)).length : 0;
    if (ownSubmissions >= currentForm.maxPerSpeaker) { setErrors({ submit: `This form allows up to ${currentForm.maxPerSpeaker} proposals per speaker.` }); return; }
    const speakerId = existingSpeaker?.id ?? `spk_${Date.now()}`;
    if (!existingSpeaker) {
      const speaker: SpeakerRecord = { id: speakerId, eventId: currentEvent.id, firstName: firstName.trim(), lastName: lastName.trim(), email, company, title: jobTitle, bio: "", location: "", website: "", linkedin: "", avatar: `${firstName[0] ?? "?"}${lastName[0] ?? ""}`.toUpperCase(), avatarColor: "#007454", confirmation: "unconfirmed", profileCompletion: 35, tags: [] };
      dispatch({ type: "ADD_SPEAKER", speaker });
    }
    const speakerIds = [speakerId];
    if (coSpeaker && coName.trim() && coEmail.trim()) {
      const existingCo = state.speakers.find((speaker) => speaker.email.toLowerCase() === coEmail.toLowerCase());
      const coId = existingCo?.id ?? `spk_co_${Date.now()}`;
      if (!existingCo) {
        const [coFirst = "", ...coRest] = coName.trim().split(/\s+/);
        dispatch({ type: "ADD_SPEAKER", speaker: { id: coId, eventId: currentEvent.id, firstName: coFirst, lastName: coRest.join(" "), email: coEmail, company: "", title: "", bio: "", location: "", website: "", linkedin: "", avatar: `${coFirst[0] ?? "?"}${coRest[0]?.[0] ?? ""}`.toUpperCase(), avatarColor: "#2d8d79", confirmation: "unconfirmed", profileCompletion: 20, tags: [] } });
      }
      speakerIds.push(coId);
    }
    // Only answers whose field is currently visible are persisted.
    const visibleKeys = new Set(visibleOf(allFields).map((field) => field.key));
    const persistedAnswers: Answers = Object.fromEntries(Object.entries(answers).filter(([key]) => visibleKeys.has(key)));
    const number = state.submissions.length + 101;
    const submission: SubmissionRecord = {
      id: `sub_${Date.now()}`, code: `SESS-${number}`, eventId: currentEvent.id, formId: currentForm.id, title: String(persistedAnswers.title ?? "Untitled session"), type: "Talk · 30 min", status: "pending", speakerIds, track: String(persistedAnswers.track ?? "Unrouted"), format: "Talk · 30 min", tags: [], submittedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), abstract: String(persistedAnswers.abstract ?? ""), audience: String(persistedAnswers.audience ?? ""), takeaways: String(persistedAnswers.takeaways ?? ""), answers: persistedAnswers, score: null, reviewCount: 0,
    };
    dispatch({ type: "ADD_SUBMISSION", submission });
    dispatch({ type: "ADD_COMMUNICATION", communication: { id: `com_${Date.now()}`, eventId: currentEvent.id, recipient: email, subject: `We received “${submission.title}”`, template: "Submission received", status: "sent", sentAt: new Date().toISOString(), preview: "Thanks for sharing your idea. Our review team will be in touch…" } });
    window.localStorage.removeItem(`openboard-draft-${currentForm.id}`);
    router.push(`/submit/${currentEvent.slug}/${currentForm.id}/done?code=${submission.code}`);
  }

  const activeFields = submissionSections.flatMap((section) => section.fields).filter((field) => !["first_name", "last_name", "email"].includes(field.key));
  return <main className="cfp-page"><header className="cfp-topbar"><div className="cfp-container"><span className="public-event-logo">AI<span>.engineer</span></span><div><span><ShieldCheck size={15} /> Secure submission</span><a href="mailto:speakers@example.com">Need help?</a></div></div></header>
    <div className="cfp-progress"><div className="cfp-container">{wizardSteps.map((label, index) => <div key={label} className={`${step === index ? "active" : ""} ${step > index ? "done" : ""}`}><span>{step > index ? <Check size={14} /> : index + 1}</span><b>{label}</b>{index < wizardSteps.length - 1 && <i />}</div>)}</div></div>
    {step === 0 ? <section className="cfp-welcome cfp-container"><div className="welcome-copy"><div className="public-eyebrow"><Sparkles size={14} /> Call for speakers · 2026</div><h1>{form.welcomeTitle}</h1><p>{form.welcomeBody}</p><div className="welcome-facts"><div><Clock3 size={19} /><span><b>Closes August 31</b><small>11:59 PM PDT</small></span></div><div><FileText size={19} /><span><b>About 12 minutes</b><small>You can save and return</small></span></div><div><Users size={19} /><span><b>Up to 3 proposals</b><small>Per speaker</small></span></div></div><button className="button button-primary button-lg" onClick={() => setStep(1)}>Start your proposal <ArrowRight size={18} /></button><small className="welcome-note">Already started? Use the same email to continue.</small></div><div className="welcome-card"><span>WHAT WE’RE LOOKING FOR</span><h2>Teach from experience.</h2><p>Our best sessions are specific, useful, and honest about the messy parts.</p><ul><li><CheckCircle2 size={16} /> Deep technical lessons</li><li><CheckCircle2 size={16} /> Original work and real outcomes</li><li><CheckCircle2 size={16} /> Clear takeaways for practitioners</li></ul><div><b>Sep 15–16, 2026</b><small>Fort Mason Center · San Francisco</small></div></div></section> : <section className="cfp-workspace cfp-container"><aside className="cfp-aside"><span className="public-event-logo">AI<span>.engineer</span></span><h2>{form.name}</h2><p>AI Engineer World’s Fair 2026</p><div className="cfp-aside-help"><Mail size={17} /><div><b>Questions?</b><span>speakers@ai.engineer</span></div></div></aside><div className="cfp-form-card">{step === 1 && <AccountStep email={email} setEmail={setEmail} code={code} setCode={setCode} sent={codeSent} verified={verified} send={sendCode} changeEmail={() => { setCodeSent(false); setCode(""); setVerified(false); setErrors({}); }} errors={errors} />}{step === 2 && <SubmissionStep fields={activeFields} allFields={allFields} answers={answers} onAnswer={answer} errors={errors} />}{step === 3 && <ParticipantStep values={{ firstName, lastName, company, jobTitle }} setters={{ setFirstName, setLastName, setCompany, setJobTitle }} coSpeaker={coSpeaker} setCoSpeaker={setCoSpeaker} coName={coName} setCoName={setCoName} coEmail={coEmail} setCoEmail={setCoEmail} customFields={visibleOf(customParticipantFields)} answers={answers} onAnswer={answer} errors={errors} error={errors.participant} />}{step === 4 && <ReviewStep fields={visibleOf(allFields).filter((field) => isAnswered(answers[field.key]))} answers={answers} name={`${firstName} ${lastName}`} email={email} coSpeaker={coSpeaker && coName.trim() ? { name: coName, email: coEmail } : null} agreed={agreed} setAgreed={setAgreed} error={errors.agreed} onEdit={setStep} />}
        {errors.submit && <div className="field-error" role="alert">{errors.submit}</div>}
        <footer className="cfp-form-footer"><button className="button button-ghost" onClick={() => setStep((value) => Math.max(0, value - 1))}><ArrowLeft size={16} /> Back</button><span className={`autosave ${autosaved ? "show" : ""}`}><Save size={14} /> Draft saved</span>{step < 4 ? <button className="button button-primary" onClick={goNext}>{step === 1 && !codeSent ? "Send code" : step === 1 ? "Verify & continue" : "Continue"}<ArrowRight size={16} /></button> : <button className="button button-primary" onClick={submit}>Submit proposal <ArrowRight size={16} /></button>}</footer></div></section>}
    <footer className="cfp-footer"><div className="cfp-container"><Brand dark /><span>Powered by Openboard · Privacy · Accessibility</span></div></footer>
  </main>;
}

function AccountStep({ email, setEmail, code, setCode, sent, send, changeEmail, errors }: { email: string; setEmail: (v: string) => void; code: string; setCode: (v: string) => void; sent: boolean; verified: boolean; send: () => void; changeEmail: () => void; errors: Record<string,string> }) {
  return <div className="cfp-step"><div className="cfp-step-icon"><UserPlus size={23} /></div><span className="cfp-step-count">STEP 2 OF 5</span><h1>{sent ? "Check your inbox" : "First, let’s save your progress"}</h1><p>{sent ? <>We sent a six-digit code to <strong>{email}</strong>.</> : "Enter your email and we’ll send a one-time code. No password needed."}</p>{!sent ? <label><span>Email address</span><input type="email" autoComplete="email" required aria-invalid={Boolean(errors.email)} autoFocus value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" />{errors.email && <em role="alert">{errors.email}</em>}</label> : <><label><span>Verification code</span><input className="otp-input" inputMode="numeric" autoComplete="one-time-code" required aria-invalid={Boolean(errors.code)} maxLength={6} autoFocus value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} placeholder="424242" />{errors.code && <em role="alert">{errors.code}</em>}</label><div className="demo-code"><Sparkles size={15} /><span><b>Demo shortcut</b> Use code <code>424242</code></span></div><button type="button" className="text-button" onClick={send}>Send a new code</button><button type="button" className="text-button" onClick={changeEmail}>Change email address</button></>}</div>;
}
function SubmissionStep({ fields, allFields, answers, onAnswer, errors }: { fields: FormFieldRecord[]; allFields: FormFieldRecord[]; answers: Answers; onAnswer: (field: FormFieldRecord, value: AnswerValue) => void; errors: Record<string,string> }) {
  return <div className="cfp-step"><span className="cfp-step-count">STEP 3 OF 5</span><h1>Share your session idea</h1><p>Be specific about what you learned and what attendees can use.</p><div className="public-form-stack">{fields.filter((field) => !field.visibility || evaluateVisibility(field, allFields, answers)).map((field) => <PublicField key={field.id} field={field} value={answers[field.key]} onChange={(value) => onAnswer(field, value)} error={errors[field.key]} />)}</div></div>;
}
function ParticipantStep({ values, setters, coSpeaker, setCoSpeaker, coName, setCoName, coEmail, setCoEmail, customFields, answers, onAnswer, errors, error }: { values: { firstName: string; lastName: string; company: string; jobTitle: string }; setters: { setFirstName: (v:string)=>void; setLastName:(v:string)=>void; setCompany:(v:string)=>void; setJobTitle:(v:string)=>void }; coSpeaker: boolean; setCoSpeaker:(v:boolean)=>void; coName: string; setCoName:(v:string)=>void; coEmail: string; setCoEmail:(v:string)=>void; customFields: FormFieldRecord[]; answers: Answers; onAnswer: (field: FormFieldRecord, value: AnswerValue) => void; errors: Record<string,string>; error: string | undefined }) {
  return <div className="cfp-step"><span className="cfp-step-count">STEP 4 OF 5</span><h1>Tell us about you</h1><p>This information becomes your speaker profile if the session is accepted.</p><div className="form-grid"><label><span>First name *</span><input required aria-invalid={Boolean(error)} value={values.firstName} onChange={(e)=>setters.setFirstName(e.target.value)} /></label><label><span>Last name *</span><input required aria-invalid={Boolean(error)} value={values.lastName} onChange={(e)=>setters.setLastName(e.target.value)} /></label><label><span>Company</span><input value={values.company} onChange={(e)=>setters.setCompany(e.target.value)} /></label><label><span>Job title</span><input value={values.jobTitle} onChange={(e)=>setters.setJobTitle(e.target.value)} /></label></div>{customFields.length > 0 && <div className="public-form-stack">{customFields.map((field)=><PublicField key={field.id} field={field} value={answers[field.key]} onChange={(value)=>onAnswer(field, value)} error={errors[field.key]} />)}</div>}{error && <div className="field-error" role="alert">{error}</div>}<button className="add-cospeaker" onClick={()=>setCoSpeaker(!coSpeaker)}><UserPlus size={18}/><div><b>{coSpeaker ? "Co-speaker added" : "Add a co-speaker"}</b><small>You can invite another person to present with you.</small></div><span>{coSpeaker ? <Check size={16}/> : <ArrowRight size={16}/>}</span></button>{coSpeaker && <div className="co-speaker-fields form-grid"><label><span>Co-speaker name</span><input required aria-invalid={Boolean(error)} value={coName} onChange={(e)=>setCoName(e.target.value)} placeholder="Full name" /></label><label><span>Co-speaker email</span><input type="email" required aria-invalid={Boolean(error)} value={coEmail} onChange={(e)=>setCoEmail(e.target.value)} placeholder="speaker@company.com" /></label></div>}</div>;
}
function ReviewStep({ fields, answers, name, email, coSpeaker, agreed, setAgreed, error, onEdit }: { fields: FormFieldRecord[]; answers: Answers; name: string; email: string; coSpeaker: { name: string; email: string } | null; agreed:boolean; setAgreed:(v:boolean)=>void; error:string | undefined; onEdit:(n:number)=>void }) {
  return <div className="cfp-step"><span className="cfp-step-count">STEP 5 OF 5</span><h1>Review your proposal</h1><p>Make sure everything looks right. You can edit until the call closes.</p><div className="review-block"><header><div><FileText size={17}/><b>Session</b></div><button onClick={()=>onEdit(2)}>Edit</button></header>{fields.map((field)=><div className="review-answer" key={field.id}><span>{field.label}</span><p>{Array.isArray(answers[field.key]) ? (answers[field.key] as string[]).join(", ") : String(answers[field.key])}</p></div>)}</div><div className="review-block"><header><div><Users size={17}/><b>Participant</b></div><button onClick={()=>onEdit(3)}>Edit</button></header><div className="review-answer"><span>Primary speaker</span><p>{name}<br/><small>{email}</small></p></div>{coSpeaker && <div className="review-answer"><span>Co-speaker</span><p>{coSpeaker.name}<br/><small>{coSpeaker.email}</small></p></div>}</div><label className={`terms-check ${error ? "error" : ""}`}><input type="checkbox" required aria-invalid={Boolean(error)} checked={agreed} onChange={(e)=>setAgreed(e.target.checked)} /><span><b>I confirm this proposal is my own work.</b><small>I agree to the speaker terms and understand the event may record accepted sessions.</small>{error && <em role="alert">{error}</em>}</span></label></div>;
}
function PublicField({ field, value, onChange, error }: { field: FormFieldRecord; value: AnswerValue | undefined; onChange: (value: AnswerValue) => void; error: string | undefined }) {
  const label = <>{field.label}{field.required && <b> *</b>}</>;
  if (field.type === "multiselect") {
    return (
      <fieldset className={`public-field ${error ? "has-error" : ""}`} aria-required={field.required} aria-invalid={Boolean(error)} tabIndex={error ? -1 : undefined}>
        <legend>{label}</legend>
        <div className="check-options">
          {field.options.map((option) => (
            <label key={option}>
              <input
                type="checkbox"
                checked={Array.isArray(value) && value.includes(option)}
                onChange={(event) => {
                  const values = Array.isArray(value) ? value : [];
                  onChange(event.target.checked ? [...values, option] : values.filter((item) => item !== option));
                }}
              />
              {option}
            </label>
          ))}
        </div>
        {field.helpText && <small>{field.helpText}</small>}
        {error && <em role="alert">{error}</em>}
      </fieldset>
    );
  }

  return (
    <label className={`public-field ${error ? "has-error" : ""}`}>
      <span>{label}</span>
      {field.type === "textarea" || field.type === "richtext"
        ? <textarea required={field.required} aria-invalid={Boolean(error)} value={String(value ?? "")} maxLength={field.maxChars ?? undefined} onChange={(event) => onChange(event.target.value)} placeholder={field.placeholder} />
        : field.type === "dropdown"
          ? <select required={field.required} aria-invalid={Boolean(error)} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)}><option value="">{field.placeholder || "Select one"}</option>{field.options.map((option) => <option key={option}>{option}</option>)}</select>
          : field.type === "file"
            ? <><input type="file" required={field.required} aria-invalid={Boolean(error)} onChange={(event) => onChange(event.target.files?.[0]?.name ?? "")} />{isAnswered(value) && <small className="file-selected">Attached: {String(value)} (stored as a file reference in this demo)</small>}</>
            : <input type={field.type === "email" ? "email" : field.type === "url" ? "url" : "text"} required={field.required} aria-invalid={Boolean(error)} value={String(value ?? "")} maxLength={field.maxChars ?? undefined} onChange={(event) => onChange(event.target.value)} placeholder={field.placeholder} />}
      {field.helpText && <small>{field.helpText}</small>}
      {field.maxChars && <i>{String(value ?? "").length} / {field.maxChars}</i>}
      {error && <em role="alert">{error}</em>}
    </label>
  );
}
function evaluateVisibility(field: FormFieldRecord, all: FormFieldRecord[], answers: Answers) { if (!field.visibility) return true; const source = all.find((item)=>item.id===field.visibility?.fieldId); const actual = source ? answers[source.key] : undefined; if(field.visibility.operator==="answered") return isAnswered(actual); if(field.visibility.operator==="empty") return !isAnswered(actual); if(field.visibility.operator==="neq") return actual!==field.visibility.value; return actual===field.visibility.value; }
function isAnswered(value: unknown) { return value !== undefined && value !== null && value !== "" && (!Array.isArray(value) || value.length > 0); }
