import { css } from 'lit';

export const actionStyles = css`
  button {
    font: inherit;
    border: 1px solid var(--divider-color);
    border-radius: 8px;
    color: var(--primary-text-color);
    background: var(--card-background-color);
    padding: 10px 12px;
    min-height: 42px;
  }
  button,
  .action-control {
    cursor: pointer;
    min-height: 42px;
    --ha-button-height: 42px;
    --ha-icon-button-size: 42px;
    --mdc-button-height: 42px;
  }
  .action-control::part(base) {
    cursor: inherit;
    min-height: 42px;
  }
  button:disabled,
  .action-control[disabled],
  .action-control[aria-disabled='true'] {
    cursor: default;
    opacity: 0.55;
  }
  button.primary {
    background: var(--primary-color);
    color: var(--text-primary-color);
    border-color: transparent;
  }
  .action-control.primary {
    --mdc-theme-primary: var(--primary-color);
    --mdc-theme-on-primary: var(--text-primary-color);
  }
  button.danger,
  .action-control.danger {
    color: var(--error-color);
    --mdc-theme-primary: var(--error-color);
    --wa-color-on-normal: var(--error-color);
  }
  .action-control.icon {
    min-width: 42px;
    padding: 0;
  }
  .action-control.icon.primary {
    background: var(--primary-color);
    color: var(--text-primary-color);
    border-radius: 8px;
  }
  :focus-visible,
  .action-control:focus-within {
    outline: 3px solid var(--state-active-color, var(--primary-color));
    outline-offset: 3px;
  }
  .action-submit-proxy[hidden] {
    display: none;
  }
`;

export const sharedStyles = css`
  ${actionStyles}
  :host {
    color: var(--primary-text-color);
    font-family: inherit;
  }
  * {
    box-sizing: border-box;
  }
  input,
  select {
    font: inherit;
    border: 1px solid var(--divider-color);
    border-radius: 8px;
    color: var(--primary-text-color);
    background: var(--card-background-color);
    padding: 10px 12px;
    min-height: 42px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .muted,
  small {
    color: var(--secondary-text-color);
  }
  .error {
    color: var(--error-color);
    border-inline-start: 3px solid currentColor;
    padding: 8px 12px;
  }
  .warning {
    border: 1px solid var(--warning-color);
    border-radius: 8px;
    padding: 12px;
  }
  .row {
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    flex-wrap: wrap;
    margin-top: 16px;
  }
  h2 {
    font-size: 1.15rem;
    margin: 0 0 16px;
  }
  p {
    line-height: 1.5;
  }
`;

export const modalStyles = css`
  :host {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: grid;
    place-items: center;
    padding: 16px;
    background: var(--mdc-dialog-scrim-color, var(--divider-color));
  }
  .dialog {
    width: min(100%, 480px);
    max-height: 90vh;
    overflow: auto;
    background: var(--ha-dialog-surface-background, var(--card-background-color));
    border-radius: 16px;
    padding: 24px;
    box-shadow: var(--dialog-box-shadow, var(--ha-card-box-shadow));
  }
  form {
    display: grid;
    gap: 16px;
  }
  .choices {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }
  .choices .action-control {
    flex: 1 1 110px;
  }
  .choices img {
    display: block;
    width: 72px;
    height: 48px;
    object-fit: contain;
    margin: 0 auto 8px;
  }
  .preview {
    padding: 12px;
    border-radius: 8px;
    background: var(--secondary-background-color);
  }
`;
