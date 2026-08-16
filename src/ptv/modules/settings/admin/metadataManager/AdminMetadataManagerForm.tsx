import { MetadataField } from '@jellyfin/sdk/lib/generated-client/models/metadata-field';
import { PersonKind } from '@jellyfin/sdk/lib/generated-client/models/person-kind';
import React, { useMemo, useState } from 'react';

import PtvIcon from '../../../icons/PtvIcon';
import type {
    AdminMetadataEditableField,
    AdminMetadataEditor,
    AdminMetadataForm,
    AdminMetadataPerson,
    AdminMetadataStudio
} from './adminMetadataManagerModel';

/* eslint-disable react/jsx-no-bind, sonarjs/cognitive-complexity */

type MetadataFormProps = Readonly<{
    conflict: boolean;
    disabled: boolean;
    feedback: string;
    form: AdminMetadataForm;
    onChange: <K extends keyof AdminMetadataForm>(field: K, value: AdminMetadataForm[K]) => void;
    onReload: () => void;
    onReset: () => void;
    onSave: () => void;
    editor: AdminMetadataEditor;
    dirty: boolean;
    saving: boolean;
}>;

type TextListEditorProps = Readonly<{
    disabled: boolean;
    label: string;
    onChange: (value: readonly string[]) => void;
    placeholder: string;
    values: readonly string[];
}>;

const PERSON_KINDS = Object.values(PersonKind);
const LOCKABLE_FIELDS = Object.values(MetadataField);

function hasField(editor: AdminMetadataEditor, field: AdminMetadataEditableField) {
    return editor.editableFields.includes(field);
}

function textNumber(value: number | null) {
    return value === null ? '' : String(value);
}

function parseNumber(value: string, integer = false) {
    if (!value.trim()) return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || (integer && !Number.isInteger(parsed))) return null;
    return parsed;
}

function TextListEditor({ disabled, label, onChange, placeholder, values }: TextListEditorProps) {
    const [ draft, setDraft ] = useState('');
    const add = () => {
        const value = draft.trim();
        if (!value || values.includes(value)) return;
        onChange([ ...values, value ]);
        setDraft('');
    };

    return (
        <fieldset className='ptv-metadata-list-editor'>
            <legend>{label}</legend>
            {values.length ? (
                <div className='ptv-metadata-chips'>
                    {values.map((value, index) => (
                        <span key={value}>
                            {value}
                            <button
                                aria-label={`Remove ${value} from ${label}`}
                                disabled={disabled}
                                onClick={() => onChange(values.filter((_, valueIndex) => valueIndex !== index))}
                                type='button'
                            >
                                <PtvIcon name='close' size='12px' />
                            </button>
                        </span>
                    ))}
                </div>
            ) : <small>No {label.toLowerCase()} configured.</small>}
            <div className='ptv-metadata-add-row'>
                <input
                    aria-label={`New ${label.toLowerCase()} value`}
                    disabled={disabled}
                    onChange={event => setDraft(event.currentTarget.value)}
                    onKeyDown={event => {
                        if (event.key !== 'Enter') return;
                        event.preventDefault();
                        add();
                    }}
                    placeholder={placeholder}
                    value={draft}
                />
                <button disabled={disabled || !draft.trim()} onClick={add} type='button'>Add</button>
            </div>
        </fieldset>
    );
}

function PeopleEditor({
    disabled,
    onChange,
    values
}: Readonly<{
    disabled: boolean;
    onChange: (value: readonly AdminMetadataPerson[]) => void;
    values: readonly AdminMetadataPerson[];
}>) {
    const add = () => onChange([ ...values, {
        id: null,
        name: '',
        role: '',
        source: null,
        type: PersonKind.Actor
    } ]);

    return (
        <fieldset className='ptv-metadata-structured-editor'>
            <legend>People</legend>
            <p>People are saved through Jellyfin&apos;s structured item metadata contract.</p>
            {values.map((person, index) => (
                <div className='ptv-metadata-person-row' key={person.id || `new-person-${index}`}>
                    <label>
                        <span>Name</span>
                        <input
                            disabled={disabled}
                            onChange={event => onChange(values.map((entry, valueIndex) => valueIndex === index ? {
                                ...entry,
                                name: event.currentTarget.value
                            } : entry))}
                            value={person.name}
                        />
                    </label>
                    <label>
                        <span>Type</span>
                        <select
                            disabled={disabled}
                            onChange={event => onChange(values.map((entry, valueIndex) => valueIndex === index ? {
                                ...entry,
                                type: event.currentTarget.value
                            } : entry))}
                            value={person.type || PersonKind.Unknown}
                        >
                            {!PERSON_KINDS.includes(person.type as typeof PERSON_KINDS[number]) && person.type ?
                                <option value={person.type}>{person.type}</option> : null}
                            {PERSON_KINDS.map(kind => <option key={kind} value={kind}>{kind}</option>)}
                        </select>
                    </label>
                    <label>
                        <span>Role</span>
                        <input
                            disabled={disabled}
                            onChange={event => onChange(values.map((entry, valueIndex) => valueIndex === index ? {
                                ...entry,
                                role: event.currentTarget.value
                            } : entry))}
                            placeholder='Character or credit'
                            value={person.role}
                        />
                    </label>
                    <button
                        aria-label={`Remove ${person.name || 'person'}`}
                        disabled={disabled}
                        onClick={() => onChange(values.filter((_, valueIndex) => valueIndex !== index))}
                        type='button'
                    >
                        <PtvIcon name='delete' size='16px' />
                    </button>
                </div>
            ))}
            <button disabled={disabled} onClick={add} type='button'>Add person</button>
        </fieldset>
    );
}

function StudiosEditor({
    disabled,
    onChange,
    values
}: Readonly<{
    disabled: boolean;
    onChange: (value: readonly AdminMetadataStudio[]) => void;
    values: readonly AdminMetadataStudio[];
}>) {
    return (
        <fieldset className='ptv-metadata-structured-editor'>
            <legend>Studios</legend>
            {values.map((studio, index) => (
                <div className='ptv-metadata-studio-row' key={studio.id || `studio-${index}`}>
                    <input
                        aria-label={`Studio ${index + 1}`}
                        disabled={disabled}
                        onChange={event => onChange(values.map((entry, valueIndex) => valueIndex === index ? {
                            ...entry,
                            name: event.currentTarget.value
                        } : entry))}
                        value={studio.name}
                    />
                    <button
                        aria-label={`Remove ${studio.name || 'studio'}`}
                        disabled={disabled}
                        onClick={() => onChange(values.filter((_, valueIndex) => valueIndex !== index))}
                        type='button'
                    >
                        <PtvIcon name='delete' size='16px' />
                    </button>
                </div>
            ))}
            <button
                disabled={disabled}
                onClick={() => onChange([ ...values, { id: null, name: '', source: null } ])}
                type='button'
            >
                Add studio
            </button>
        </fieldset>
    );
}

export function validateAdminMetadataFormForUi(form: AdminMetadataForm) {
    const errors: string[] = [];
    if (!form.name.trim()) errors.push('Name is required.');
    if (form.premiereDate && !/^\d{4}-\d{2}-\d{2}$/.test(form.premiereDate)) {
        errors.push('Premiere date must be a valid date.');
    }
    if (form.endDate && !/^\d{4}-\d{2}-\d{2}$/.test(form.endDate)) {
        errors.push('End date must be a valid date.');
    }
    if (form.runtimeMinutes !== null && form.runtimeMinutes < 0) errors.push('Runtime cannot be negative.');
    if (form.people.some(person => !person.name.trim())) errors.push('Every person must have a name.');
    if (form.studios.some(studio => !studio.name.trim())) errors.push('Every studio must have a name.');
    return errors;
}

export default function AdminMetadataManagerForm({
    conflict,
    disabled,
    dirty,
    editor,
    feedback,
    form,
    onChange,
    onReload,
    onReset,
    onSave,
    saving
}: MetadataFormProps) {
    const validationErrors = useMemo(() => validateAdminMetadataFormForUi(form), [ form ]);
    const fieldDisabled = disabled || saving || conflict;

    return (
        <form className='ptv-metadata-form' onSubmit={event => {
            event.preventDefault();
            onSave();
        }}>
            {conflict ? (
                <div className='ptv-metadata-notice is-warning' role='alert'>
                    <PtvIcon name='alerts' size='20px' />
                    <span>
                        <strong>This item changed on the server while you were editing.</strong>
                        <small>Your edits are still here. Reload before saving.</small>
                    </span>
                    <button onClick={onReload} type='button'>Reload item</button>
                </div>
            ) : null}

            <section className='ptv-metadata-form-section'>
                <header><span>01</span><div><h3>General</h3><p>Primary titles and the description shown throughout PiggieTV.</p></div></header>
                <div className='ptv-metadata-field-grid'>
                    <label className='is-wide'>
                        <span>Name</span>
                        <input
                            aria-invalid={!form.name.trim() || undefined}
                            disabled={fieldDisabled}
                            onChange={event => onChange('name', event.currentTarget.value)}
                            required
                            value={form.name}
                        />
                    </label>
                    {hasField(editor, 'originalTitle') ? <label>
                        <span>Original title</span>
                        <input disabled={fieldDisabled} onChange={event => onChange('originalTitle', event.currentTarget.value)} value={form.originalTitle} />
                    </label> : null}
                    <label>
                        <span>Sort title</span>
                        <input disabled={fieldDisabled} onChange={event => onChange('sortName', event.currentTarget.value)} value={form.sortName} />
                    </label>
                    <label className='is-wide'>
                        <span>Overview</span>
                        <textarea disabled={fieldDisabled} onChange={event => onChange('overview', event.currentTarget.value)} rows={6} value={form.overview} />
                    </label>
                    {hasField(editor, 'tagline') ? <label className='is-wide'>
                        <span>Tagline</span>
                        <input disabled={fieldDisabled} onChange={event => onChange('tagline', event.currentTarget.value)} value={form.tagline} />
                    </label> : null}
                </div>
            </section>

            {(hasField(editor, 'productionYear') || hasField(editor, 'indexNumber')) ? (
                <section className='ptv-metadata-form-section'>
                    <header><span>02</span><div><h3>Release & Numbering</h3><p>Dates and numbering relevant to this item type.</p></div></header>
                    <div className='ptv-metadata-field-grid is-compact'>
                        {hasField(editor, 'productionYear') ? <label>
                            <span>Production year</span>
                            <input disabled={fieldDisabled} inputMode='numeric' onChange={event => onChange('productionYear', parseNumber(event.currentTarget.value, true))} type='number' value={textNumber(form.productionYear)} />
                        </label> : null}
                        {hasField(editor, 'premiereDate') ? <label>
                            <span>Premiere date</span>
                            <input disabled={fieldDisabled} onChange={event => onChange('premiereDate', event.currentTarget.value)} type='date' value={form.premiereDate} />
                        </label> : null}
                        {hasField(editor, 'endDate') ? <label>
                            <span>End date</span>
                            <input disabled={fieldDisabled} onChange={event => onChange('endDate', event.currentTarget.value)} type='date' value={form.endDate} />
                        </label> : null}
                        {hasField(editor, 'parentIndexNumber') ? <label>
                            <span>Season / disc number</span>
                            <input disabled={fieldDisabled} inputMode='numeric' onChange={event => onChange('parentIndexNumber', parseNumber(event.currentTarget.value, true))} type='number' value={textNumber(form.parentIndexNumber)} />
                        </label> : null}
                        {hasField(editor, 'indexNumber') ? <label>
                            <span>Episode / track number</span>
                            <input disabled={fieldDisabled} inputMode='numeric' onChange={event => onChange('indexNumber', parseNumber(event.currentTarget.value, true))} type='number' value={textNumber(form.indexNumber)} />
                        </label> : null}
                        {hasField(editor, 'runtimeMinutes') ? <label>
                            <span>Runtime (minutes)</span>
                            <input disabled={fieldDisabled} min='0' onChange={event => onChange('runtimeMinutes', parseNumber(event.currentTarget.value))} step='0.1' type='number' value={textNumber(form.runtimeMinutes)} />
                        </label> : null}
                    </div>
                </section>
            ) : null}

            <section className='ptv-metadata-form-section'>
                <header><span>03</span><div><h3>Classification</h3><p>Genres, tags, ratings, and production context.</p></div></header>
                <div className='ptv-metadata-field-grid is-compact'>
                    {hasField(editor, 'officialRating') ? <label>
                        <span>Official rating</span>
                        <select disabled={fieldDisabled} onChange={event => onChange('officialRating', event.currentTarget.value)} value={form.officialRating}>
                            {!editor.parentalRatings.some(option => option.value === form.officialRating) && form.officialRating ? <option value={form.officialRating}>{form.officialRating}</option> : null}
                            <option value=''>Not set</option>
                            {editor.parentalRatings.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                    </label> : null}
                    {hasField(editor, 'customRating') ? <label>
                        <span>Custom rating</span>
                        <input disabled={fieldDisabled} onChange={event => onChange('customRating', event.currentTarget.value)} value={form.customRating} />
                    </label> : null}
                    {hasField(editor, 'communityRating') ? <label>
                        <span>Community rating</span>
                        <input disabled={fieldDisabled} onChange={event => onChange('communityRating', parseNumber(event.currentTarget.value))} step='0.1' type='number' value={textNumber(form.communityRating)} />
                    </label> : null}
                    {hasField(editor, 'criticRating') ? <label>
                        <span>Critic rating</span>
                        <input disabled={fieldDisabled} onChange={event => onChange('criticRating', parseNumber(event.currentTarget.value))} step='0.1' type='number' value={textNumber(form.criticRating)} />
                    </label> : null}
                </div>
                {hasField(editor, 'genres') ? <TextListEditor disabled={fieldDisabled} label='Genres' onChange={value => onChange('genres', value)} placeholder='Add a genre' values={form.genres} /> : null}
                {hasField(editor, 'tags') ? <TextListEditor disabled={fieldDisabled} label='Tags' onChange={value => onChange('tags', value)} placeholder='Add a tag' values={form.tags} /> : null}
                {hasField(editor, 'productionLocations') ? <TextListEditor disabled={fieldDisabled} label='Production locations' onChange={value => onChange('productionLocations', value)} placeholder='Add a location' values={form.productionLocations} /> : null}
            </section>

            {(hasField(editor, 'people') || hasField(editor, 'studios')) ? (
                <section className='ptv-metadata-form-section'>
                    <header><span>04</span><div><h3>People & Studios</h3><p>Structured credits retained by Jellyfin when this item is saved.</p></div></header>
                    {hasField(editor, 'people') ? <PeopleEditor disabled={fieldDisabled} onChange={value => onChange('people', value)} values={form.people} /> : null}
                    {hasField(editor, 'studios') ? <StudiosEditor disabled={fieldDisabled} onChange={value => onChange('studios', value)} values={form.studios} /> : null}
                </section>
            ) : null}

            {hasField(editor, 'providerIds') ? (
                <section className='ptv-metadata-form-section'>
                    <header><span>05</span><div><h3>Provider IDs</h3><p>Stable identifiers reported by Jellyfin&apos;s installed metadata providers.</p></div></header>
                    <div className='ptv-metadata-provider-grid'>
                        {editor.providerFields.map(provider => (
                            <label key={provider.key}>
                                <span>{provider.label}{!provider.available ? <small>Unavailable</small> : null}</span>
                                <input
                                    disabled={fieldDisabled}
                                    onChange={event => onChange('providerIds', {
                                        ...form.providerIds,
                                        [provider.key]: event.currentTarget.value || null
                                    })}
                                    value={form.providerIds[provider.key] || ''}
                                />
                            </label>
                        ))}
                    </div>
                </section>
            ) : null}

            {(hasField(editor, 'lockData') || hasField(editor, 'lockedFields')) ? (
                <section className='ptv-metadata-form-section'>
                    <header><span>06</span><div><h3>Metadata Locks</h3><p>Protect selected values from automatic provider refreshes.</p></div></header>
                    {hasField(editor, 'lockData') && form.lockData !== null ? (
                        <label aria-label='Lock all metadata' className='ptv-metadata-switch-row'>
                            <span><strong>Lock all metadata</strong><small>Prevent automatic provider changes to this item&apos;s metadata.</small></span>
                            <input aria-label='Lock all metadata' checked={form.lockData} disabled={fieldDisabled} onChange={event => onChange('lockData', event.currentTarget.checked)} type='checkbox' />
                        </label>
                    ) : null}
                    {hasField(editor, 'lockedFields') ? (
                        <fieldset className='ptv-metadata-lock-grid'>
                            <legend>Locked fields</legend>
                            {LOCKABLE_FIELDS.map(field => (
                                <label key={field}>
                                    <input
                                        checked={form.lockedFields.includes(field)}
                                        disabled={fieldDisabled || form.lockData === true}
                                        onChange={event => onChange('lockedFields', event.currentTarget.checked ?
                                            [ ...form.lockedFields, field ] :
                                            form.lockedFields.filter(value => value !== field))}
                                        type='checkbox'
                                    />
                                    <span>{field.replace(/([A-Z])/g, ' $1').trim()}</span>
                                </label>
                            ))}
                        </fieldset>
                    ) : null}
                </section>
            ) : null}

            {validationErrors.length ? (
                <div className='ptv-metadata-validation' role='alert'>
                    <strong>Review these fields before saving</strong>
                    <ul>{validationErrors.map(error => <li key={error}>{error}</li>)}</ul>
                </div>
            ) : null}

            <footer className='ptv-metadata-form-actions'>
                <span aria-live='polite' className={feedback ? 'has-feedback' : ''}>{feedback}</span>
                <div>
                    <button disabled={!dirty || saving} onClick={onReset} type='button'>Reset Changes</button>
                    <button className='is-primary' disabled={!dirty || conflict || saving || validationErrors.length > 0} type='submit'>
                        {saving ? 'Saving...' : 'Save Metadata'}
                    </button>
                </div>
            </footer>
        </form>
    );
}
/* eslint-enable react/jsx-no-bind, sonarjs/cognitive-complexity */
