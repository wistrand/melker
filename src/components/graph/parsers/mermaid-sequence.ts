/**
 * Mermaid Sequence Diagram Parser
 *
 * Parses Mermaid sequence diagram syntax into SequenceDefinition.
 *
 * Supported syntax:
 * - sequenceDiagram
 * - participant/actor definitions
 * - Messages: ->>, -->>
 * - Notes: Note left/right/over of X: text
 * - Activation: activate/deactivate, or +/- suffix
 * - Fragments: loop, alt/else, opt, par, critical, break
 */

import type {
  SequenceDefinition,
  SequenceParticipant,
  SequenceMessage,
  SequenceNote,
  SequenceFragment,
  SequenceEvent,
  SequenceArrowStyle,
  FragmentType,
  FragmentSection,
} from '../types.ts';
import { GraphParseError, type SequenceDiagramParser } from './types.ts';

/**
 * Sequence diagram parser
 */
export class SequenceParser implements SequenceDiagramParser {
  parse(input: string): SequenceDefinition {
    const lines = input
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('%%'));

    if (lines.length === 0) {
      throw new GraphParseError('Empty input');
    }

    // Check for sequenceDiagram marker
    const firstLine = lines[0].toLowerCase();
    if (!firstLine.startsWith('sequencediagram')) {
      throw new GraphParseError('Expected "sequenceDiagram" at start');
    }

    const participants = new Map<string, SequenceParticipant>();
    const events: SequenceEvent[] = [];
    let title: string | undefined;

    // Parse remaining lines
    let i = 1;
    while (i < lines.length) {
      const line = lines[i];
      i++;

      // Parse title
      if (line.toLowerCase().startsWith('title')) {
        const match = line.match(/^title\s*:?\s*(.+)$/i);
        if (match) {
          title = match[1].trim();
        }
        continue;
      }

      // Parse participant/actor definition
      const participantMatch = line.match(/^(participant|actor)\s+(\S+)(?:\s+as\s+(.+))?$/i);
      if (participantMatch) {
        const type = participantMatch[1].toLowerCase() as 'participant' | 'actor';
        const id = participantMatch[2];
        const label = participantMatch[3]?.trim() || id;
        participants.set(id, { id, label, type });
        continue;
      }

      // Parse note
      const noteMatch = line.match(/^note\s+(left|right|over)\s+(?:of\s+)?([^:]+):\s*(.+)$/i);
      if (noteMatch) {
        const position = noteMatch[1].toLowerCase() as 'left' | 'right' | 'over';
        const participantIds = noteMatch[2].split(',').map(p => p.trim());
        const text = noteMatch[3].trim();

        // Auto-create participants if not defined
        for (const pid of participantIds) {
          if (!participants.has(pid)) {
            participants.set(pid, { id: pid, label: pid, type: 'participant' });
          }
        }

        events.push({
          type: 'note',
          note: { position, participants: participantIds, text },
        });
        continue;
      }

      // Parse activate/deactivate
      const activateMatch = line.match(/^(activate|deactivate)\s+(\S+)$/i);
      if (activateMatch) {
        const action = activateMatch[1].toLowerCase();
        const participant = activateMatch[2];

        if (!participants.has(participant)) {
          participants.set(participant, { id: participant, label: participant, type: 'participant' });
        }

        events.push({
          type: action as 'activate' | 'deactivate',
          participant,
        });
        continue;
      }

      // Parse fragment start (loop, alt, opt, par, critical, break)
      const fragmentMatch = line.match(/^(loop|alt|opt|par|critical|break)(?:\s+(.+))?$/i);
      if (fragmentMatch) {
        const fragmentType = fragmentMatch[1].toLowerCase() as FragmentType;
        const label = fragmentMatch[2]?.trim();

        // Parse fragment content until 'end'
        const result = this._parseFragment(lines, i, fragmentType, label, participants);
        events.push({ type: 'fragment', fragment: result.fragment });
        i = result.nextIndex;
        continue;
      }

      // Parse message: A->>B: text, A-->>B: text, A-)B: text, A--)B: text
      const messageMatch = line.match(/^(\S+?)\s*(--?>>?|--?\)|--?x|--?[)x])\s*(\+?)(\S+?)(-?):\s*(.*)$/i);
      if (messageMatch) {
        const from = messageMatch[1];
        const arrowStr = messageMatch[2];
        const activateTarget = messageMatch[3] === '+';
        const to = messageMatch[4];
        const deactivateSource = messageMatch[5] === '-';
        const label = messageMatch[6].trim();

        // Auto-create participants if not defined
        if (!participants.has(from)) {
          participants.set(from, { id: from, label: from, type: 'participant' });
        }
        if (!participants.has(to)) {
          participants.set(to, { id: to, label: to, type: 'participant' });
        }

        const arrow = this._parseArrowStyle(arrowStr);
        const message: SequenceMessage = {
          from,
          to,
          label,
          arrow,
        };

        if (activateTarget) {
          message.activate = true;
        }
        if (deactivateSource) {
          message.deactivate = true;
        }

        events.push({ type: 'message', message });
        continue;
      }

      // Also try simpler message format without colon
      const simpleMessageMatch = line.match(/^(\S+?)\s*(--?>>?|--?\)|--?x)\s*(\S+?)$/i);
      if (simpleMessageMatch) {
        const from = simpleMessageMatch[1];
        const arrowStr = simpleMessageMatch[2];
        const to = simpleMessageMatch[3];

        if (!participants.has(from)) {
          participants.set(from, { id: from, label: from, type: 'participant' });
        }
        if (!participants.has(to)) {
          participants.set(to, { id: to, label: to, type: 'participant' });
        }

        events.push({
          type: 'message',
          message: {
            from,
            to,
            label: '',
            arrow: this._parseArrowStyle(arrowStr),
          },
        });
        continue;
      }

      // Unknown line - skip silently (could be comments or unsupported syntax)
    }

    return {
      diagramType: 'sequence',
      participants: Array.from(participants.values()),
      events,
      title,
    };
  }

  /**
   * Parse arrow string to arrow style
   */
  private _parseArrowStyle(arrow: string): SequenceArrowStyle {
    const isDashed = arrow.startsWith('--');
    const isOpen = arrow.includes(')') || arrow.includes('x');

    if (isDashed && isOpen) return 'dashedOpen';
    if (isDashed) return 'dashed';
    if (isOpen) return 'solidOpen';
    return 'solid';
  }

  /**
   * Parse a fragment (loop, alt, etc.) including nested content
   */
  private _parseFragment(
    lines: string[],
    startIndex: number,
    fragmentType: FragmentType,
    label: string | undefined,
    participants: Map<string, SequenceParticipant>
  ): { fragment: SequenceFragment; nextIndex: number } {
    const sections: FragmentSection[] = [];
    let currentSection: FragmentSection = { label, events: [] };
    let i = startIndex;
    let depth = 1;

    while (i < lines.length && depth > 0) {
      const line = lines[i];

      // Check for nested fragment start
      const nestedFragmentMatch = line.match(/^(loop|alt|opt|par|critical|break)(?:\s+(.+))?$/i);
      if (nestedFragmentMatch) {
        const nestedType = nestedFragmentMatch[1].toLowerCase() as FragmentType;
        const nestedLabel = nestedFragmentMatch[2]?.trim();
        i++;

        const result = this._parseFragment(lines, i, nestedType, nestedLabel, participants);
        currentSection.events.push({ type: 'fragment', fragment: result.fragment });
        i = result.nextIndex;
        continue;
      }

      // Check for 'else' (only valid in alt)
      if (line.toLowerCase().startsWith('else')) {
        const elseMatch = line.match(/^else(?:\s+(.+))?$/i);
        sections.push(currentSection);
        currentSection = {
          label: elseMatch?.[1]?.trim(),
          events: [],
        };
        i++;
        continue;
      }

      // Check for 'end'
      if (line.toLowerCase() === 'end') {
        depth--;
        if (depth === 0) {
          sections.push(currentSection);
          i++;
          break;
        }
      }

      // Parse message within fragment
      const messageMatch = line.match(/^(\S+?)\s*(--?>>?|--?\)|--?x)\s*(\+?)(\S+?)(-?):\s*(.*)$/i);
      if (messageMatch) {
        const from = messageMatch[1];
        const arrowStr = messageMatch[2];
        const activateTarget = messageMatch[3] === '+';
        const to = messageMatch[4];
        const deactivateSource = messageMatch[5] === '-';
        const msgLabel = messageMatch[6].trim();

        if (!participants.has(from)) {
          participants.set(from, { id: from, label: from, type: 'participant' });
        }
        if (!participants.has(to)) {
          participants.set(to, { id: to, label: to, type: 'participant' });
        }

        const message: SequenceMessage = {
          from,
          to,
          label: msgLabel,
          arrow: this._parseArrowStyle(arrowStr),
        };
        if (activateTarget) message.activate = true;
        if (deactivateSource) message.deactivate = true;

        currentSection.events.push({ type: 'message', message });
        i++;
        continue;
      }

      // Parse note within fragment
      const noteMatch = line.match(/^note\s+(left|right|over)\s+(?:of\s+)?([^:]+):\s*(.+)$/i);
      if (noteMatch) {
        const position = noteMatch[1].toLowerCase() as 'left' | 'right' | 'over';
        const participantIds = noteMatch[2].split(',').map(p => p.trim());
        const text = noteMatch[3].trim();

        for (const pid of participantIds) {
          if (!participants.has(pid)) {
            participants.set(pid, { id: pid, label: pid, type: 'participant' });
          }
        }

        currentSection.events.push({
          type: 'note',
          note: { position, participants: participantIds, text },
        });
        i++;
        continue;
      }

      // Skip unknown lines
      i++;
    }

    return {
      fragment: {
        type: fragmentType,
        label,
        sections,
      },
      nextIndex: i,
    };
  }
}

/**
 * Check if content looks like a sequence diagram
 */
export function isSequenceDiagram(content: string): boolean {
  const firstLine = content.trim().split('\n')[0]?.toLowerCase() || '';
  return firstLine.startsWith('sequencediagram');
}
