import { t } from '../i18n.js'
import {
  PRIORITY_MAX,
  announce,
  api,
  collator,
  composeBranch,
  composeDialog,
  composeForm,
  composeNewBranch,
  composeNewProject,
  composeProject,
  el,
  errorText,
  labelName,
  labelPicker,
  markLocal,
  newBranchField,
  newProjectField,
  option,
  showToast,
  state,
} from './core.js'
import { loadBoard, loadProjects } from './board.js'

let composeTarget = 'backlog'
const composeLabels = new Set()

function projectNames() {
  const names = new Set(['Inbox'])
  for (const project of state.projects) names.add(project.name)
  for (const task of state.tasks) names.add(task.project)
  return [...names].filter(Boolean).sort((a, b) => collator().compare(a, b))
}

function projectByName(name) {
  return state.projects.find((project) => project.name === name)
}

export function populateComposeProjects(preferred) {
  const names = projectNames()
  const selected =
    names.includes(preferred) ? preferred : names.includes('Inbox') ? 'Inbox' : names[0]

  composeProject.replaceChildren(
    ...names.map((name) => option(name, name)),
    option('__new__', t('compose.newProject')),
  )
  composeProject.value = selected
  syncNewProjectField()
  populateComposeBranches()
}

export function populateComposeBranches(preferred = '') {
  const repository = projectByName(composeProject.value)
  const branches = repository?.branches ?? []
  composeBranch.replaceChildren(
    option('', t('compose.noBranch')),
    ...branches.map((branch) =>
      option(branch, branch === repository.current_branch ? `${branch} *` : branch),
    ),
    option('__new__', t('compose.newBranch')),
  )

  const value = preferred && (preferred === '__new__' || branches.includes(preferred))
    ? preferred
    : ''
  composeBranch.value = value
  syncNewBranchField()
}

export function syncNewProjectField(focus = false) {
  const isNew = composeProject.value === '__new__'
  newProjectField.hidden = !isNew
  composeNewProject.hidden = !isNew
  if (isNew && focus) requestAnimationFrame(() => composeNewProject.focus())
}

export function syncNewBranchField(focus = false) {
  const isNew = composeBranch.value === '__new__'
  newBranchField.hidden = !isNew
  composeNewBranch.hidden = !isNew
  if (isNew && focus) requestAnimationFrame(() => composeNewBranch.focus())
}

export function openCompose(status = 'backlog') {
  composeTarget = status
  composeForm.reset()
  composeLabels.clear()
  const preferred = state.project !== 'all' ? state.project : 'Inbox'
  populateComposeProjects(preferred)
  populateComposeBranches()
  renderLabelPicker()
  labelName.value = ''
  composeDialog.showModal()
  requestAnimationFrame(() => composeForm.elements.title.focus())
  void loadProjects().then(() => populateComposeProjects(composeProject.value))
}

export function renderLabelPicker() {
  if (!state.labels.length) {
    labelPicker.replaceChildren(el('span', 'label-empty', t('compose.noLabels')))
    return
  }

  labelPicker.replaceChildren(
    ...state.labels.map((label) => {
      const chip = el('button', 'label-choice', label.name)
      chip.type = 'button'
      chip.style.setProperty('--label-color', label.color)
      chip.setAttribute('aria-pressed', String(composeLabels.has(label.name)))
      chip.addEventListener('click', () => {
        if (composeLabels.has(label.name)) composeLabels.delete(label.name)
        else composeLabels.add(label.name)
        chip.setAttribute('aria-pressed', String(composeLabels.has(label.name)))
      })
      return chip
    }),
  )
}

export async function addLabel() {
  const name = labelName.value.trim()
  if (!name) {
    showToast(t('toast.labelRequired'), { error: true })
    labelName.focus()
    return
  }

  try {
    const { label } = await api('/api/labels', { method: 'POST', body: { name } })
    if (!state.labels.some((item) => item.name === label.name)) {
      state.labels.push(label)
      state.labels.sort((a, b) => collator().compare(a.name, b.name))
    }
    composeLabels.add(label.name)
    labelName.value = ''
    renderLabelPicker()
    showToast(t('toast.labelCreated', { name: label.name }))
  } catch (error) {
    showToast(t('toast.labelFailed', { error: errorText(error) }), { error: true })
  }
}

export async function submitCompose(event) {
  event.preventDefault()
  const form = new FormData(composeForm)
  const title = String(form.get('title') ?? '').trim()
  if (!title) {
    composeForm.elements.title.focus()
    return
  }

  const project =
    composeProject.value === '__new__'
      ? composeNewProject.value.trim()
      : composeProject.value
  if (!project) {
    showToast(t('error.project_required'), { error: true })
    composeNewProject.focus()
    return
  }

  const branch =
    composeBranch.value === '__new__'
      ? composeNewBranch.value.trim()
      : composeBranch.value

  const priorityValue = Number(form.get('priority') ?? 2)
  const priority = Number.isInteger(priorityValue)
    ? Math.min(PRIORITY_MAX, Math.max(0, priorityValue))
    : 2

  try {
    markLocal()
    const created = await api('/api/tasks', {
      method: 'POST',
      body: {
        title,
        body: String(form.get('body') ?? ''),
        project,
        branch,
        priority,
        labels: [...composeLabels],
      },
    })
    composeDialog.close()
    if (composeTarget !== 'backlog') {
      await api(`/api/tasks/${encodeURIComponent(created.task.id)}/move`, {
        method: 'POST',
        body: { status: composeTarget },
      })
    }
    await loadBoard()
    void loadProjects()
    showToast(t('toast.created', { id: created.task.id }))
    announce(t('announce.created', { id: created.task.id }))
  } catch (error) {
    showToast(t('toast.createFailed', { error: errorText(error) }), { error: true })
  }
}