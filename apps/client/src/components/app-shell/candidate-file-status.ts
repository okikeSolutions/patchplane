import type { CandidateChangedFile } from '@patchplane/core/diff/project-candidate-changed-files'
import * as m from '@/paraglide/messages'

export function candidateFileStatus(file: CandidateChangedFile) {
  const changeKindPresentation: Record<
    CandidateChangedFile['changeKind'],
    { readonly label: string }
  > = {
    added: { label: m.app_file_added() },
    modified: { label: m.app_file_modified() },
    deleted: { label: m.app_file_deleted() },
    renamed: { label: m.app_file_renamed() },
    copied: { label: m.app_file_copied() },
    'type-changed': { label: m.app_file_type_changed() },
    unmerged: { label: m.app_file_unmerged() },
  }
  const contentKindPresentation: Record<
    CandidateChangedFile['contentKind'],
    {
      readonly description: string
      readonly label: string
      readonly marker: string | undefined
    }
  > = {
    text: {
      description: m.app_file_text_content(),
      label: m.app_file_text(),
      marker: undefined,
    },
    binary: {
      description: m.app_file_binary_content(),
      label: m.app_file_binary(),
      marker: m.app_file_binary(),
    },
    submodule: {
      description: m.app_file_submodule_content(),
      label: m.app_file_submodule(),
      marker: m.app_file_submodule(),
    },
    unknown: {
      description: m.app_file_unknown_content(),
      label: m.app_file_unknown(),
      marker: '?',
    },
  }
  const change = changeKindPresentation[file.changeKind]
  const content = contentKindPresentation[file.contentKind]
  return {
    changeLabel: change.label,
    contentLabel: content.label,
    marker:
      content.marker === undefined
        ? change.label
        : `${change.label} · ${content.marker}`,
    title: `${change.label}; ${content.description}`,
  }
}
