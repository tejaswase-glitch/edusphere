// Shared data helpers used by several views.
import { sb, esc } from './core.js';
import { options } from './ui.js';

export async function getSubjects() {
  const { data, error } = await sb.from('subjects').select('id,name,description,is_active').order('name');
  if (error) return []; // table missing (migration not run) -> views fall back to free text
  return data;
}
export async function getCourses() {
  const { data, error } = await sb.from('courses').select('id,title,subject,description,is_active,created_by').order('title');
  if (error) throw error; return data;
}
// A <select> of subjects, or a plain text box if no subjects exist yet.
export function subjectField(subjects, value = '', label = 'Subject') {
  const act = subjects.filter(s => s.is_active).map(s => s.name);
  if (value && !act.includes(value)) act.push(value);
  return act.length
    ? `<label>${esc(label)}<select name="subject" required>${options(act, value, 'Select subject')}</select></label>`
    : `<label>${esc(label)}<input name="subject" required maxlength="100" value="${esc(value)}"></label>`;
}
export const courseField = (courses, value = '') =>
  `<label>Course <small>(optional)</small><select name="course_id">${options(courses.filter(c => c.is_active || c.id === value).map(c => ({ value: c.id, label: c.title })), value, 'No specific course')}</select></label>`;
