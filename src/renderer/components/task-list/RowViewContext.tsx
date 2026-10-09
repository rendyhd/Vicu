import { createContext, useContext } from 'react'
import { NO_ROW_VIEW, type RowView } from '@/lib/row-anatomy'

/**
 * What the view around the rows already says (the project they are in, the tag they are listed
 * under, whether the list mixes projects), so a row leaves it off its meta line. Views that say
 * nothing need no provider. Pass a stable value (a module constant or a memo).
 */
const RowViewContextValue = createContext<RowView>(NO_ROW_VIEW)
export const RowViewProvider = RowViewContextValue.Provider
export const useRowView = () => useContext(RowViewContextValue)
