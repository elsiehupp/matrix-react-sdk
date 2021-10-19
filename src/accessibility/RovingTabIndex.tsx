/*
Copyright 2020 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import React, {
    createContext,
    useCallback,
    useContext,
    useLayoutEffect,
    useMemo,
    useRef,
    useReducer,
    Reducer,
    Dispatch,
} from "react";

import { Key } from "../Keyboard";
import { FocusHandler, Ref } from "./roving/types";

/**
 * Module to simplify implementing the Roving TabIndex accessibility technique
 *
 * Wrap the Widget in an RovingTabIndexContextProvider
 * and then for all buttons make use of useRovingTabIndex or RovingTabIndexWrapper.
 * The code will keep track of which tabIndex was most recently focused and expose that information as `isActive` which
 * can then be used to only set the tabIndex to 0 as expected by the roving tabindex technique.
 * When the active button gets unmounted the closest button will be chosen as expected.
 * Initially the first button to mount will be given active state.
 *
 * https://developer.mozilla.org/en-US/docs/Web/Accessibility/Keyboard-navigable_JavaScript_widgets#Technique_1_Roving_tabindex
 */

const DOCUMENT_POSITION_PRECEDING = 2;

export interface IState {
    activeRef: Ref;
    refs: Ref[];
}

interface IContext {
    state: IState;
    dispatch: Dispatch<IAction>;
}

const RovingTabIndexContext = createContext<IContext>({
    state: {
        activeRef: null,
        refs: [], // list of refs in DOM order
    },
    dispatch: () => {},
});
RovingTabIndexContext.displayName = "RovingTabIndexContext";

enum Type {
    Register = "REGISTER",
    Unregister = "UNREGISTER",
    SetFocus = "SET_FOCUS",
}

interface IAction {
    type: Type;
    payload: {
        ref: Ref;
    };
}

const reducer = (state: IState, action: IAction) => {
    switch (action.type) {
        case Type.Register: {
            if (state.refs.length === 0) {
                // Our list of refs was empty, set activeRef to this first item
                state.activeRef = action.payload.ref;
                state.refs = [action.payload.ref];
                return { ...state };
            }

            let left = 0;
            let right = state.refs.length - 1;
            let index = state.refs.length; // by default append to the end
            // do a binary search to find the right slot whilst also breaking if we find ourselves to inline the scan
            while (left <= right) {
                index = Math.floor((left + right) / 2);
                const elem = state.refs[index].current;

                if (elem === action.payload.ref.current) {
                    return state; // already in refs, this should not happen
                }

                if (action.payload.ref.current.compareDocumentPosition(elem) & DOCUMENT_POSITION_PRECEDING) {
                    left = index + 1;
                } else {
                    right = index - 1;
                }
            }

            // update the refs list
            state.refs.splice(index, 0, action.payload.ref);
            return { ...state };
        }

        case Type.Unregister: {
            const oldIndex = state.refs.findIndex(r => r === action.payload.ref);

            if (oldIndex === -1) {
                return state; // already removed, this should not happen
            }

            if (state.refs.splice(oldIndex, 1)[0] === state.activeRef) {
                // we just removed the active ref, need to replace it
                // pick the ref which is now in the index the old ref was in
                const len = state.refs.length;
                state.activeRef = oldIndex >= len ? state.refs[len - 1] : state.refs[oldIndex];
            }

            // update the refs list
            return { ...state };
        }

        case Type.SetFocus: {
            // update active ref
            state.activeRef = action.payload.ref;
            return { ...state };
        }

        default:
            return state;
    }
};

interface IProps {
    handleHomeEnd?: boolean;
    handleUpDown?: boolean;
    children(renderProps: {
        onKeyDownHandler(ev: React.KeyboardEvent);
    });
    onKeyDown?(ev: React.KeyboardEvent, state: IState);
}

export const RovingTabIndexProvider: React.FC<IProps> = ({ children, handleHomeEnd, handleUpDown, onKeyDown }) => {
    const [state, dispatch] = useReducer<Reducer<IState, IAction>>(reducer, {
        activeRef: null,
        refs: [],
    });

    const context = useMemo<IContext>(() => ({ state, dispatch }), [state]);

    const onKeyDownHandler = useCallback((ev) => {
        let handled = false;
        // Don't interfere with input default keydown behaviour
        if (ev.target.tagName !== "INPUT" && ev.target.tagName !== "TEXTAREA") {
            // check if we actually have any items
            switch (ev.key) {
                case Key.HOME:
                    if (handleHomeEnd) {
                        handled = true;
                        // move focus to first item
                        if (context.state.refs.length > 0) {
                            context.state.refs[0].current.focus();
                        }
                    }
                    break;

                case Key.END:
                    if (handleHomeEnd) {
                        handled = true;
                        // move focus to last item
                        if (context.state.refs.length > 0) {
                            context.state.refs[context.state.refs.length - 1].current.focus();
                        }
                    }
                    break;

                case Key.ARROW_UP:
                    if (handleUpDown) {
                        handled = true;
                        if (context.state.refs.length > 0) {
                            const idx = context.state.refs.indexOf(context.state.activeRef);
                            if (idx > 0) {
                                context.state.refs[idx - 1].current.focus();
                            }
                        }
                    }
                    break;

                case Key.ARROW_DOWN:
                    if (handleUpDown) {
                        handled = true;
                        if (context.state.refs.length > 0) {
                            const idx = context.state.refs.indexOf(context.state.activeRef);
                            if (idx < context.state.refs.length - 1) {
                                context.state.refs[idx + 1].current.focus();
                            }
                        }
                    }
                    break;
            }
        }

        if (handled) {
            ev.preventDefault();
            ev.stopPropagation();
        } else if (onKeyDown) {
            return onKeyDown(ev, context.state);
        }
    }, [context.state, onKeyDown, handleHomeEnd, handleUpDown]);

    return <RovingTabIndexContext.Provider value={context}>
        { children({ onKeyDownHandler }) }
    </RovingTabIndexContext.Provider>;
};

// Hook to register a roving tab index
// inputRef parameter specifies the ref to use
// onFocus should be called when the index gained focus in any manner
// isActive should be used to set tabIndex in a manner such as `tabIndex={isActive ? 0 : -1}`
// ref should be passed to a DOM node which will be used for DOM compareDocumentPosition
export const useRovingTabIndex = (inputRef?: Ref): [FocusHandler, boolean, Ref] => {
    const context = useContext(RovingTabIndexContext);
    let ref = useRef<HTMLElement>(null);

    if (inputRef) {
        // if we are given a ref, use it instead of ours
        ref = inputRef;
    }

    // setup (after refs)
    useLayoutEffect(() => {
        context.dispatch({
            type: Type.Register,
            payload: { ref },
        });
        // teardown
        return () => {
            context.dispatch({
                type: Type.Unregister,
                payload: { ref },
            });
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const onFocus = useCallback(() => {
        context.dispatch({
            type: Type.SetFocus,
            payload: { ref },
        });
    }, [ref, context]);

    const isActive = context.state.activeRef === ref;
    return [onFocus, isActive, ref];
};

// re-export the semantic helper components for simplicity
export { RovingTabIndexWrapper } from "./roving/RovingTabIndexWrapper";
export { RovingAccessibleButton } from "./roving/RovingAccessibleButton";
export { RovingAccessibleTooltipButton } from "./roving/RovingAccessibleTooltipButton";
