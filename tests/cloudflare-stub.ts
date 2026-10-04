export class DurableObject<T> {
  constructor(
    protected ctx: DurableObjectState,
    protected env: T,
  ) {}
}
