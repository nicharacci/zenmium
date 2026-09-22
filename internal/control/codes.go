package control

// Error codes ported 1:1 from desktop/src/main/browser-control*.ts.
// Keep this set closed: products key off these strings; add codes only in a
// new BROWSER_CONTROL_VERSION.

// Code is a browser-control error code.
type Code string

const (
	CodeUnauthorized            Code = "UNAUTHORIZED"
	CodeWorkspaceNotFound       Code = "WORKSPACE_NOT_FOUND"
	CodeTabOutOfScope           Code = "TAB_OUT_OF_SCOPE"
	CodeSessionOutOfScope       Code = "SESSION_OUT_OF_SCOPE"
	CodeCapabilityDenied        Code = "CAPABILITY_DENIED"
	CodeRequestConflict         Code = "REQUEST_CONFLICT"
	CodeRequestLimit            Code = "REQUEST_LIMIT"
	CodeSessionBusy             Code = "SESSION_BUSY"
	CodeHumanControl            Code = "HUMAN_CONTROL"
	CodeStaleRevision           Code = "STALE_REVISION"
	CodeObservationRequired     Code = "OBSERVATION_REQUIRED"
	CodeOneTabPolicy            Code = "ONE_TAB_POLICY"
	CodeAuthenticationProtected Code = "AUTHENTICATION_PROTECTED"
	CodeTargetUnavailable       Code = "TARGET_UNAVAILABLE"
	CodeControlInterrupted      Code = "CONTROL_INTERRUPTED"
	CodeTargetChanged           Code = "TARGET_CHANGED"
	CodeStaleObservation        Code = "STALE_OBSERVATION"
	CodeOriginMismatch          Code = "ORIGIN_MISMATCH"
	CodeAuthProviderUnavailable Code = "AUTH_PROVIDER_UNAVAILABLE"
	CodeReauthorizeSession      Code = "REAUTHORIZE_SESSION"
	CodeActionPending           Code = "ACTION_PENDING"
	CodeActionTimeout           Code = "ACTION_TIMEOUT"
	CodeInvalidCommand          Code = "INVALID_COMMAND"
	CodeNativeActionFailed      Code = "NATIVE_ACTION_FAILED"
	CodeJournalUnavailable      Code = "JOURNAL_UNAVAILABLE"
	CodeDisposed                Code = "DISPOSED"
	CodeInvalidJSON             Code = "INVALID_JSON"
	CodeInvalidRequest          Code = "INVALID_REQUEST"
	CodeBodyTooLarge            Code = "BODY_TOO_LARGE"
	CodeUnknownTool             Code = "UNKNOWN_TOOL"
)

// Error is the structured control-plane error. Uncertain mirrors the
// Electron flag: the driver could not prove the action did not execute
// (timeout/disconnect), so callers must re-observe before retrying.
type Error struct {
	Code      Code   `json:"code"`
	Message   string `json:"message"`
	Uncertain bool   `json:"uncertain,omitempty"`
}

func (e *Error) Error() string { return string(e.Code) + ": " + e.Message }

func newError(code Code, msg string) *Error { return &Error{Code: code, Message: msg} }

func uncertainError(code Code, msg string) *Error {
	return &Error{Code: code, Message: msg, Uncertain: true}
}

// Exported constructors for the relay/driver boundary.

// ErrFromCode rebuilds a control error from its wire code.
func ErrFromCode(code, msg string, uncertain bool) *Error {
	e := &Error{Code: Code(code), Message: msg, Uncertain: uncertain}
	if e.Code == "" {
		e.Code = CodeNativeActionFailed
	}
	return e
}

// ErrTargetUnavailable is reported when the workspace executor is gone.
func ErrTargetUnavailable() *Error { return newError(CodeTargetUnavailable, "executor unavailable") }

// ErrControlInterrupted is reported when the executor channel dies mid-action.
func ErrControlInterrupted() *Error {
	return uncertainError(CodeControlInterrupted, "control channel interrupted")
}

// ErrActionTimeout is the bounded 15s driver timeout (uncertain: the action
// may have landed before the channel timed out).
func ErrActionTimeout() *Error { return uncertainError(CodeActionTimeout, "action timed out") }
