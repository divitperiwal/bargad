# Build from the repo root: docker build -f apps/engine/Dockerfile .
FROM golang:1.27.3 AS build
WORKDIR /src
COPY apps/engine/go.mod apps/engine/go.sum ./
RUN go mod download
COPY apps/engine/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/engine ./cmd/engine

# static includes CA certificates (broker APIs are HTTPS) and tzdata (trading days are IST).
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/engine /engine
EXPOSE 8081
ENTRYPOINT ["/engine"]
