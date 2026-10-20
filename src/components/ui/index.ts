/**
 * Biblioteca de UI do app — ponto unico de importacao.
 *
 * Uso: import { Button, Card, useToast } from "@/components/ui";
 *
 * Todo componente aqui consome apenas os tokens de globals.css: nenhuma tela
 * inventa cor, raio ou sombra propria.
 */

export { Alert } from "./alert";
export type { AlertProps, AlertTipo } from "./alert";

export { Badge } from "./badge";
export type { BadgeProps, BadgeTamanho, BadgeTom } from "./badge";

export { Button } from "./button";
export type { ButtonProps, ButtonTamanho, ButtonVariante } from "./button";

export { Card, CardBody, CardFooter, CardHeader } from "./card";
export type {
  CardBodyProps,
  CardFooterProps,
  CardHeaderProps,
  CardProps,
} from "./card";

export { CopyField } from "./copy-field";
export type { CopyFieldProps } from "./copy-field";

export { EmptyState } from "./empty-state";
export type { EmptyStateProps } from "./empty-state";

export { FieldGroup } from "./field-group";
export type { FieldGroupProps } from "./field-group";

export { Input, Textarea } from "./input";
export type { CampoBaseProps, InputProps, TextareaProps } from "./input";

export { Skeleton, SkeletonText } from "./skeleton";
export type { SkeletonProps, SkeletonTextProps } from "./skeleton";

export { Spinner } from "./spinner";
export type { SpinnerProps, SpinnerTamanho } from "./spinner";

export { Stepper } from "./stepper";
export type { Etapa, StepperProps } from "./stepper";

export { ToastProvider, useToast } from "./toast";
export type {
  DispararToast,
  Toast,
  ToastApi,
  ToastOpcoes,
  ToastProviderProps,
  ToastTipo,
} from "./toast";
