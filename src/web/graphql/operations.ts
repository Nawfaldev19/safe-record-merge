import { graphql } from './tada';

export const MemberParts = graphql(`
  fragment MemberParts on Member @_unmask {
    id
    firstName
    lastName
    email
    phone
    notes
    source
    stage
    stagePin
    duesPaidUntil
    tripCount
    isRead
    revision
    createdAt
  }
`);

export const ViewerQuery = graphql(`
  query Viewer {
    viewer {
      id
      name
      email
      memberships {
        role
        workspace {
          id
          name
        }
      }
    }
  }
`);

export const LoginMutation = graphql(`
  mutation Login($email: String!, $password: String!) {
    login(email: $email, password: $password) {
      id
    }
  }
`);

export const LogoutMutation = graphql(`
  mutation Logout {
    logout
  }
`);

export const StageCountsQuery = graphql(`
  query StageCounts($workspaceId: ID!) {
    workspace(id: $workspaceId) {
      id
      stageCounts {
        stage
        total
        unread
      }
    }
  }
`);

export const RosterQuery = graphql(
  `
    query Roster(
      $workspaceId: ID!
      $after: String
      $stage: Stage
      $search: String
      $sort: MemberSort
    ) {
      workspace(id: $workspaceId) {
        id
        members(first: 25, after: $after, stage: $stage, search: $search, sort: $sort) {
          endCursor
          hasNextPage
          items {
            ...MemberParts
          }
        }
      }
    }
  `,
  [MemberParts],
);

export const CreateMemberMutation = graphql(`
  mutation CreateMember($workspaceId: ID!, $input: MemberInput!) {
    createMember(workspaceId: $workspaceId, input: $input) {
      id
    }
  }
`);

export const MemberQuery = graphql(
  `
    query Member($workspaceId: ID!, $memberId: ID!) {
      workspace(id: $workspaceId) {
        id
        member(id: $memberId) {
          mergedFrom {
            id
            firstName
            lastName
          }
          member {
            ...MemberParts
            signups {
              id
              tripTitle
              happensOn
              attended
            }
            payments {
              id
              amountCents
              paidOn
              coversUntil
            }
            activity {
              id
              kind
              summary
              actorName
              occurredAt
            }
          }
        }
      }
    }
  `,
  [MemberParts],
);

export const UpdateMemberMutation = graphql(`
  mutation UpdateMember(
    $workspaceId: ID!
    $memberId: ID!
    $input: MemberInput!
    $expectedRevision: Int!
  ) {
    updateMember(
      workspaceId: $workspaceId
      memberId: $memberId
      input: $input
      expectedRevision: $expectedRevision
    ) {
      id
      revision
    }
  }
`);

export const SetStagePinMutation = graphql(`
  mutation SetStagePin($workspaceId: ID!, $memberId: ID!, $pin: Stage) {
    setStagePin(workspaceId: $workspaceId, memberId: $memberId, pin: $pin) {
      id
      stage
      stagePin
      revision
    }
  }
`);

export const MarkReadMutation = graphql(`
  mutation MarkRead($workspaceId: ID!, $memberId: ID!) {
    markMemberRead(workspaceId: $workspaceId, memberId: $memberId)
  }
`);

export const DuplicatesQuery = graphql(
  `
    query Duplicates($workspaceId: ID!) {
      workspace(id: $workspaceId) {
        id
        duplicates {
          membersChecked
          comparisons
          pairs {
            id
            score
            reasons
            left {
              ...MemberParts
            }
            right {
              ...MemberParts
            }
          }
        }
      }
    }
  `,
  [MemberParts],
);

export const DismissDuplicateMutation = graphql(`
  mutation DismissDuplicate($workspaceId: ID!, $firstId: ID!, $secondId: ID!) {
    dismissDuplicate(workspaceId: $workspaceId, firstId: $firstId, secondId: $secondId)
  }
`);

export const MergePreviewQuery = graphql(
  `
    query MergePreview($workspaceId: ID!, $leftId: ID!, $rightId: ID!) {
      workspace(id: $workspaceId) {
        id
        mergePreview(leftId: $leftId, rightId: $rightId) {
          sharedTrips
          leftOnlyTrips
          rightOnlyTrips
          leftPayments
          rightPayments
          left {
            ...MemberParts
          }
          right {
            ...MemberParts
          }
        }
      }
    }
  `,
  [MemberParts],
);

export const MergeMembersMutation = graphql(`
  mutation MergeMembers($workspaceId: ID!, $input: MergeInput!) {
    mergeMembers(workspaceId: $workspaceId, input: $input) {
      mergeId
      survivor {
        id
      }
    }
  }
`);

export const MergesQuery = graphql(`
  query Merges($workspaceId: ID!) {
    workspace(id: $workspaceId) {
      id
      merges {
        id
        survivorId
        survivorName
        absorbedName
        mergedByName
        mergedAt
        undoneAt
        canUndo
        undoBlockedBy
      }
    }
  }
`);

export const UndoMergeMutation = graphql(`
  mutation UndoMerge($workspaceId: ID!, $mergeId: ID!) {
    undoMerge(workspaceId: $workspaceId, mergeId: $mergeId) {
      id
      undoneAt
      canUndo
      undoBlockedBy
    }
  }
`);
