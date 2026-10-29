'use client';
/** A pack's details (new or changed), and adding its questions (step 2.8f). */
import { useActionState, useState } from 'react';
import type { AdminPack, PackAccess } from '@whosabi/shared-types';
import { CATEGORY_NAME } from '../../../lib/content';
import { addQuestions, savePack, type FormState } from './actions';

const IDLE: FormState = { done: null, error: null };

const ACCESS_LABEL: Record<PackAccess, string> = {
  free: 'Free to everyone',
  coins: 'Unlocked with coins',
  sponsored: 'Sponsored (free, branded)',
  pass: 'Sabi Pass (v1.1: locked until then)',
};

/** An ISO time as a datetime-local value in WAT. */
const toWat = (iso: string | null) =>
  iso ? new Date(Date.parse(iso) + 3_600_000).toISOString().slice(0, 16) : '';

const slugOf = (title: string) =>
  title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

export function PackForm({ pack, canEdit }: { pack?: AdminPack; canEdit: boolean }) {
  const [state, action, pending] = useActionState(savePack.bind(null, pack?.id ?? null), IDLE);
  const [access, setAccess] = useState<PackAccess>(pack?.access ?? 'free');
  const [slug, setSlug] = useState(pack?.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(Boolean(pack));
  return (
    <form action={action} className="stack" data-testid="pack-form">
      <fieldset disabled={!canEdit} className="stack">
        <div className="field-grid">
          <label>
            Title
            <input
              name="title"
              required
              minLength={2}
              maxLength={60}
              defaultValue={pack?.title}
              placeholder="Owambe Starter Pack"
              data-testid="pack-title"
              onChange={(e) => (slugTouched ? null : setSlug(slugOf(e.target.value)))}
            />
          </label>
          <label>
            Short name (in links)
            <input
              name="slug"
              required
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              maxLength={60}
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value);
              }}
            />
          </label>
          <label>
            Who can play it
            <select
              name="access"
              value={access}
              onChange={(e) => setAccess(e.target.value as PackAccess)}
              data-testid="pack-access"
            >
              {(Object.keys(ACCESS_LABEL) as PackAccess[]).map((a) => (
                <option key={a} value={a}>
                  {ACCESS_LABEL[a]}
                </option>
              ))}
            </select>
          </label>
          {access === 'coins' ? (
            <label>
              Price (coins)
              <input
                name="price_coins"
                type="number"
                min={1}
                max={5000}
                required
                defaultValue={pack?.price_coins ?? 300}
                data-testid="pack-price"
              />
            </label>
          ) : null}
          <label>
            Also every live question in
            <select name="category_id" defaultValue={pack?.category_id ?? ''}>
              <option value="">No category (only the questions chosen)</option>
              {Object.entries(CATEGORY_NAME).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Starts (WAT, optional)
            <input name="starts_at" type="datetime-local" defaultValue={toWat(pack?.starts_at ?? null)} />
          </label>
          <label>
            Ends (WAT, optional)
            <input name="ends_at" type="datetime-local" defaultValue={toWat(pack?.ends_at ?? null)} />
          </label>
        </div>
        <label>
          Description (optional)
          <input name="description" maxLength={200} defaultValue={pack?.description ?? ''} />
        </label>
        <label className="check">
          <input type="checkbox" name="active" defaultChecked={pack?.active ?? true} />
          Players can see it (a pack is switched off, never deleted)
        </label>
        {canEdit ? (
          <div className="row">
            <button type="submit" className="primary" disabled={pending} data-testid="save-pack">
              {pack ? 'Save' : 'Make the pack'}
            </button>
          </div>
        ) : null}
      </fieldset>
      {state.error ? (
        <p className="error" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.done ? (
        <p className="ok" role="status" data-testid="pack-saved">
          {state.done}
        </p>
      ) : null}
    </form>
  );
}

export function AddQuestions({ packId }: { packId: string }) {
  const [state, action, pending] = useActionState(addQuestions.bind(null, packId), IDLE);
  return (
    <form action={action} className="stack" data-testid="add-questions">
      <label>
        Question ids or references (e.g. SEED-0001), separated by spaces, commas or new lines
        <textarea name="refs" rows={4} required data-testid="pack-refs" />
      </label>
      <div className="row">
        <button type="submit" disabled={pending} data-testid="add-to-pack">
          Add to the pack
        </button>
      </div>
      {state.error ? (
        <p className="error" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.done ? (
        <p className="ok" role="status" data-testid="questions-added">
          {state.done}
        </p>
      ) : null}
    </form>
  );
}
