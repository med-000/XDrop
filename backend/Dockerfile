FROM golang:1.25-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o server ./cmd/main.go


FROM alpine:3.21

WORKDIR /app

RUN apk add --no-cache ca-certificates

COPY --from=builder /app/server .

RUN adduser -D appuser
USER appuser

EXPOSE 8080

CMD ["./server"]